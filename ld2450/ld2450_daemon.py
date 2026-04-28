"""LD2450 presence-detection daemon.

Reads radar frames from UART, filters targets to a rectangular zone,
tracks PRESENT/ABSENT state, drives the display by simulating a press of
the monitor's power button, and notifies the mirror over HTTP. On the
PRESENT transition it also spawns face_reco_once.py so the mirror knows
who walked up.

Button wiring (Option A — direct GPIO, see the LD2450 spec
"Display Button Interface"):
  GPIO17 (pin 11) ──[1 kΩ]── SIG  (S601 on the monitor button PCB)
  GND Pi  (pin 9) ──────────── GNDmon (other S601 pin, common ground)

GPIO17 idles as INPUT (high-Z) so it does not load the monitor's pull-up.
A "press" briefly switches it to OUTPUT LOW for BUTTON_PULSE_MS ms and
then back to INPUT. 100 ms confirmed working on the live monitor.

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
import urllib.request
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('ld2450')

FRAME_HEADER = bytes([0xFD, 0xFC, 0xFB, 0xFA])
FRAME_FOOTER = bytes([0x04, 0x03, 0x02, 0x01])
FRAME_MIN_LEN = 10  # header(4) + length(2) + data(0+) + footer(4)

GPIO_BUTTON = 17
PRESENCE_X_MM = 400      # half-width of detection zone (+-40cm)
PRESENCE_Y_MM = 1500     # depth of detection zone (1.5m)
ABSENCE_TIMEOUT_SEC = 60 # spec 2026-04-26: 60 s instead of the v1 120 s
BUTTON_PULSE_MS = 100    # confirmed working on the live monitor

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

MM_ENDPOINT = os.environ.get(
    "MMP_ENDPOINT",
    "http://127.0.0.1:8080/mmm-profile/event",
)
FACE_RECO_SCRIPT = os.environ.get(
    "FACE_RECO_SCRIPT",
    "/home/admin/ld2450/face_reco_once.py",
)


def parse_frame(data: bytes) -> list:
    """Parse a LD2450 binary frame. Returns list of (x, y, speed) tuples or []."""
    if len(data) < FRAME_MIN_LEN:
        return []
    if data[:4] != FRAME_HEADER:
        return []
    if data[-4:] != FRAME_FOOTER:
        return []
    payload_len = struct.unpack_from('<H', data, 4)[0]
    payload = data[6:6 + payload_len]
    targets = []
    for i in range(0, min(len(payload), 18), 6):
        if i + 6 > len(payload):
            break
        x, y, speed = struct.unpack_from('<hhH', payload, i)
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

def post_event(payload: dict, endpoint: str = MM_ENDPOINT) -> None:
    """POST a JSON event to MMM-Profile. Failures are logged, never raised."""
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            log.info("posted %s -> HTTP %s", payload.get("event"), resp.status)
    except Exception as exc:  # noqa: BLE001
        log.warning("post failed: %s", exc)


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
    GPIO.setwarnings(False)
    GPIO.setup(GPIO_BUTTON, GPIO.IN)  # idle high-Z
    log.info("GPIO%d ready (idle INPUT)", GPIO_BUTTON)
    return GPIO


def pulse_button(GPIO):
    """Pull SIG to GND for BUTTON_PULSE_MS ms to simulate a button press.

    Toggle pattern: INPUT (idle) -> OUTPUT LOW (pulse) -> INPUT (idle).
    """
    GPIO.setup(GPIO_BUTTON, GPIO.OUT, initial=GPIO.LOW)
    time.sleep(BUTTON_PULSE_MS / 1000)
    GPIO.setup(GPIO_BUTTON, GPIO.IN)
    log.info("button pulsed")


def read_frame(ser) -> bytes:
    """Read one complete LD2450 frame from the serial port."""
    buf = b""
    while True:
        byte = ser.read(1)
        if not byte:
            continue
        buf += byte
        if len(buf) >= 4 and buf[-4:] == FRAME_FOOTER:
            if buf[:4] == FRAME_HEADER:
                return buf
            buf = b""  # bad frame, drop and resync


def main() -> int:
    import serial
    GPIO = setup_gpio()
    tracker = PresenceTracker(
        x_mm=PRESENCE_X_MM,
        y_mm=PRESENCE_Y_MM,
        timeout_sec=ABSENCE_TIMEOUT_SEC,
    )
    face_reco_proc: subprocess.Popen | None = None
    try:
        with serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1) as ser:
            log.info("daemon started, listening on %s @ %d baud",
                     SERIAL_DEVICE, SERIAL_BAUD)
            while True:
                frame = read_frame(ser)
                targets = parse_frame(frame)
                event = tracker.update(targets)
                if event == "PRESENT":
                    log.info("PRESENT — display ON, posting presence_on")
                    pulse_button(GPIO)
                    post_event({"event": "presence_on"})
                    face_reco_proc = trigger_face_reco(face_reco_proc)
                elif event == "ABSENT":
                    log.info("ABSENT — display OFF, posting presence_off")
                    pulse_button(GPIO)
                    post_event({"event": "presence_off"})
    except KeyboardInterrupt:
        log.info("daemon stopped")
        return 0
    finally:
        try:
            GPIO.cleanup()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    raise SystemExit(main())
