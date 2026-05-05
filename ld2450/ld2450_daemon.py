"""LD2450 presence-detection daemon.

Reads radar frames from UART, filters targets to a rectangular zone,
tracks PRESENT/ABSENT state, drives the display via a GPIO-toggled relay
and notifies the mirror over MQTT. On the PRESENT transition it also
spawns face_reco_once.py so the mirror knows who walked up.

The parser and PresenceTracker are deliberately platform-independent
(no `serial` or `RPi.GPIO` import at module level) so the test suite
runs anywhere. setup_gpio / read_frame / main lazy-import the
hardware-only modules.
"""

import json
import math
import os
import struct
import subprocess
import time
import logging
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('ld2450')

FRAME_HEADER = bytes([0xAA, 0xFF, 0x03, 0x00])  # Engineering mode
FRAME_FOOTER = bytes([0x55, 0xCC])  # Engineering mode
FRAME_LEN = 30  # header(4) + data(24) + footer(2)

GPIO_RELAY = 17
PRESENCE_X_MM = 400      # half-width of detection zone (+-40cm)
PRESENCE_Y_MM = 1500     # depth of detection zone (1.5m)
ABSENCE_TIMEOUT_SEC = 60 # spec 2026-04-26: 60 s instead of the v1 120 s
RELAY_PULSE_MS = 100

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

MQTT_BROKER = os.environ.get("MQTT_BROKER", "127.0.0.1")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC_PRESENCE = "smartmirror/radar/presence"

FACE_RECO_SCRIPT = os.environ.get(
    "FACE_RECO_SCRIPT",
    "/home/admin/smartMirror/camera/face_reco_once.py",
)


def parse_frame(data: bytes) -> list:
    """Parse LD2450 Engineering mode frame. Returns list of (x, y, speed) tuples.

    Frame structure (30 bytes):
    - Header: AA FF 03 00 (4 bytes)
    - Target 1: X(2) Y(2) Speed(2) Reserved(2) = 8 bytes
    - Target 2: X(2) Y(2) Speed(2) Reserved(2) = 8 bytes
    - Target 3: X(2) Y(2) Speed(2) Reserved(2) = 8 bytes
    - Footer: 55 CC (2 bytes)
    """
    if len(data) != FRAME_LEN:
        return []
    if data[:4] != FRAME_HEADER:
        return []
    if data[28:30] != FRAME_FOOTER:
        return []

    # Extract payload (24 bytes = 3 targets × 8 bytes each)
    payload = data[4:28]
    targets = []

    for i in range(0, 24, 8):  # 3 targets, 8 bytes each
        x = struct.unpack_from('<h', payload, i)[0]      # signed 16-bit X
        y = struct.unpack_from('<h', payload, i+2)[0]    # signed 16-bit Y
        speed = struct.unpack_from('<H', payload, i+4)[0] # unsigned 16-bit speed
        # Reserved at i+6 (2 bytes) - ignored

        # Filter out empty targets (0,0)
        if x != 0 or y != 0:
            targets.append((x, y, speed))

    return targets


def calculate_distance(x: int, y: int) -> float:
    """Calculate Euclidean distance in mm from radar origin."""
    return math.sqrt(x ** 2 + y ** 2)


class PresenceTracker:
    def __init__(self, x_mm: int, y_mm: int, timeout_sec: int):
        self.x_mm = x_mm      # half-width of detection zone (+-x_mm)
        self.y_mm = y_mm      # depth of detection zone (0 to y_mm)
        self.timeout_sec = timeout_sec
        self._present = False
        self._last_seen = None  # time when presence was last detected

    @property
    def is_present(self) -> bool:
        return self._present

    def update(self, targets: list):
        """
        Feed new targets. Returns 'PRESENT', 'ABSENT', or None.
        - 'PRESENT': someone just entered the rectangular zone
        - 'ABSENT': no one in zone for timeout_sec seconds
        - None: no state change
        """
        in_range = any(
            abs(x) <= self.x_mm and 0 < y <= self.y_mm
            for x, y, _ in targets
            if not (x == 0 and y == 0)
        )

        now = time.monotonic()

        if in_range:
            self._last_seen = now
            if not self._present:
                self._present = True
                return 'PRESENT'
            return None

        # Nothing in range
        if self._present:
            elapsed = (now - self._last_seen) if self._last_seen else self.timeout_sec
            if elapsed >= self.timeout_sec:
                self._present = False
                self._last_seen = None
                return 'ABSENT'
        return None


# --- HTTP + subprocess helpers (no Pi-specific deps) ---------------------

def mqtt_publish(client: mqtt.Client, topic: str, payload: str) -> None:
    """Publish MQTT message. Failures are logged, never raised."""
    try:
        result = client.publish(topic, payload, qos=1)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            log.info("MQTT published: %s -> %s", topic, payload)
        else:
            log.warning("MQTT publish failed: rc=%d", result.rc)
    except Exception as exc:  # noqa: BLE001
        log.warning("MQTT publish error: %s", exc)


def trigger_face_reco(running: subprocess.Popen | None,
                      script: str = FACE_RECO_SCRIPT) -> subprocess.Popen | None:
    """Spawn face_reco_once.py if it isn't already running. Returns the handle."""
    if running is not None and running.poll() is None:
        log.info("face_reco still running, skipping trigger")
        return running
    if not os.path.exists(script):
        log.warning("face_reco script not found: %s", script)
        return None
    try:
        proc = subprocess.Popen(
            ["python3", script],
            stdout=subprocess.DEVNULL,  # logs go to stderr -> journald
        )
        log.info("face_reco_once spawned (pid=%s)", proc.pid)
        return proc
    except Exception as exc:  # noqa: BLE001
        log.error("failed to spawn face_reco: %s", exc)
        return None


# --- hardware-bound (lazy-imported) -------------------------------------

def setup_gpio():
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(GPIO_RELAY, GPIO.OUT, initial=GPIO.LOW)
    log.info("GPIO%d ready", GPIO_RELAY)
    return GPIO


def pulse_relay(GPIO):
    """Pulse GPIO_RELAY for RELAY_PULSE_MS ms to simulate a button press."""
    GPIO.output(GPIO_RELAY, GPIO.HIGH)
    time.sleep(RELAY_PULSE_MS / 1000)
    GPIO.output(GPIO_RELAY, GPIO.LOW)
    log.info("relay pulsed")


def read_frame(ser) -> bytes:
    """Read one complete LD2450 Engineering mode frame (30 bytes)."""
    buf = b""
    while True:
        byte = ser.read(1)
        if not byte:
            continue
        buf += byte

        # Engineering mode frames are exactly 30 bytes
        if len(buf) >= FRAME_LEN:
            # Check if we have a valid frame
            if buf[-FRAME_LEN:][:4] == FRAME_HEADER and buf[-2:] == FRAME_FOOTER:
                return buf[-FRAME_LEN:]  # Return exactly 30 bytes
            # Look for header in buffer to resync
            header_idx = buf.find(FRAME_HEADER)
            if header_idx >= 0:
                buf = buf[header_idx:]  # Keep from header onward
            else:
                buf = buf[-4:]  # Keep last 4 bytes for potential header match


def main() -> int:
    import serial
    GPIO = setup_gpio()
    tracker = PresenceTracker(
        x_mm=PRESENCE_X_MM,
        y_mm=PRESENCE_Y_MM,
        timeout_sec=ABSENCE_TIMEOUT_SEC,
    )
    face_reco_proc: subprocess.Popen | None = None

    # Setup MQTT client
    mqtt_client = mqtt.Client(client_id="ld2450_daemon")
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start()  # Run in background thread
        log.info("MQTT connected to %s:%d", MQTT_BROKER, MQTT_PORT)
    except Exception as exc:
        log.error("MQTT connection failed: %s", exc)
        return 1

    try:
        with serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1) as ser:
            log.info("daemon started, listening on %s @ %d baud",
                     SERIAL_DEVICE, SERIAL_BAUD)
            while True:
                frame = read_frame(ser)
                targets = parse_frame(frame)
                event = tracker.update(targets)
                if event == "PRESENT":
                    log.info("PRESENT — display ON, publishing to MQTT")
                    pulse_relay(GPIO)
                    mqtt_publish(mqtt_client, MQTT_TOPIC_PRESENCE, "present")
                    face_reco_proc = trigger_face_reco(face_reco_proc)
                elif event == "ABSENT":
                    log.info("ABSENT — display OFF, publishing to MQTT")
                    pulse_relay(GPIO)
                    mqtt_publish(mqtt_client, MQTT_TOPIC_PRESENCE, "absent")
    except KeyboardInterrupt:
        log.info("daemon stopped")
        return 0
    finally:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        try:
            GPIO.cleanup()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    raise SystemExit(main())
