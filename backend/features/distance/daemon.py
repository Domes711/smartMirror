"""HC-SR04 distance-sensor daemon.

Pings the sensor over GPIO (TRIG/ECHO, no UART), converts the echo pulse
width to centimetres, and publishes live readings + presence-style "near"
status over MQTT.

The conversion and filtering (cm_from_echo, clean_reading) are deliberately
platform-independent (no `RPi.GPIO` import at module level) so the test
suite runs anywhere. setup_gpio / read_echo_seconds / main lazy-import the
hardware-only module.
"""

import json
import logging
import sys
import os
import threading
import time

sys.path.insert(0, os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from features.distance import constants  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('distance')


def load_config() -> dict:
    from features.distance import config as distance_config
    return distance_config.load()


def cm_from_echo(echo_seconds: float) -> float:
    """Convert an ECHO pulse width to a distance in cm.

    Round trip: sound travels to the target and back, so the pulse covers
    twice the distance — hence the /2.
    """
    return (echo_seconds * constants.SPEED_OF_SOUND_CM_PER_S) / 2


def clean_reading(cm: float, max_range_cm: int = 400):
    """Drop implausible readings: a failed/absent echo (0 or negative) or
    anything past the sensor's spec'd range (likely a mis-timed / noisy
    pulse, not a real distant object)."""
    if cm <= 0 or cm > max_range_cm:
        return None
    return round(cm, 1)


def average_reading(samples: list) -> float | None:
    """Mean of the valid (non-None) samples collected over one averaging
    window — smooths the per-ping jitter HC-SR04 readings have (a window of
    just one sample reduces to today's raw-reading behaviour).

    None if every sample in the window was a dropped/missing echo.
    """
    valid = [s for s in samples if s is not None]
    if not valid:
        return None
    return round(sum(valid) / len(valid), 1)


class PresenceTracker:
    """present/absent over the *averaged* readings (one per window), not the
    raw pings — each call to update() is one published READING.

    PRESENT fires the moment a reading is at or below warn_cm — no debounce
    on the way in, someone stepping into range should register immediately.
    ABSENT only fires after `absent_after_n` *consecutive* above-threshold
    (or missing/no-echo) readings in a row, so one stray far reading can't
    flip the display off while someone is still standing there.
    """

    def __init__(self, warn_cm: int, absent_after_n: int = 1):
        self.warn_cm = warn_cm
        self.absent_after_n = max(1, absent_after_n)
        self._present = False
        self._far_streak = 0

    @property
    def is_present(self) -> bool:
        return self._present

    def update(self, cm: float | None):
        """Feed one averaged reading. Returns 'PRESENT', 'ABSENT', or None
        (no state change)."""
        near = cm is not None and cm <= self.warn_cm

        if near:
            self._far_streak = 0
            if not self._present:
                self._present = True
                return "PRESENT"
            return None

        self._far_streak += 1
        if self._present and self._far_streak >= self.absent_after_n:
            self._present = False
            return "ABSENT"
        return None


class StreamLease:
    """Opt-in live READING stream, held by the dev console.

    Off by default and expires on its own STREAM_TIMEOUT_S after the last
    renewal, so a client that disappears without saying "stop" can't leave
    the broker flooded. Thread-safe: the MQTT thread calls handle(), the
    sample loop calls is_active().
    """

    def __init__(self, timeout_s: float = constants.STREAM_TIMEOUT_S):
        self.timeout_s = timeout_s
        self._lock = threading.Lock()
        self._deadline = None

    def handle(self, active: bool, now: float) -> None:
        with self._lock:
            self._deadline = now + self.timeout_s if active else None

    def is_active(self, now: float) -> bool:
        with self._lock:
            return self._deadline is not None and now < self._deadline


# --- hardware-bound (lazy-imported) -------------------------------------

def setup_gpio():
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(constants.GPIO_TRIG, GPIO.OUT, initial=GPIO.LOW)
    GPIO.setup(constants.GPIO_ECHO, GPIO.IN)
    log.info("GPIO ready (TRIG=%d OUT, ECHO=%d IN)",
             constants.GPIO_TRIG, constants.GPIO_ECHO)
    return GPIO


def read_echo_seconds(GPIO) -> float | None:
    """Fire one trigger pulse and time how long ECHO stays high.

    Returns None on timeout (no object in range, or a missed edge) instead
    of raising — a single bad ping must not kill the sample loop.
    """
    GPIO.output(constants.GPIO_TRIG, True)
    time.sleep(0.00001)  # 10µs trigger pulse, per datasheet
    GPIO.output(constants.GPIO_TRIG, False)

    deadline = time.monotonic() + constants.ECHO_TIMEOUT_S
    while GPIO.input(constants.GPIO_ECHO) == 0:
        if time.monotonic() > deadline:
            return None
    start = time.monotonic()

    deadline = time.monotonic() + constants.ECHO_TIMEOUT_S
    while GPIO.input(constants.GPIO_ECHO) == 1:
        if time.monotonic() > deadline:
            return None
    return time.monotonic() - start


def main() -> int:
    from shared import db
    from features.distance import mqtt as distance_mqtt

    db.init()
    GPIO = setup_gpio()

    cfg = load_config()
    tracker = PresenceTracker(warn_cm=cfg["warn_cm"],
                               absent_after_n=cfg["absent_after_n"])

    # One client for the whole feature (readings + control + config RPC) —
    # a second MqttClient with the same client_id would fight the broker for
    # the connection (mosquitto drops the older one on a client_id clash).
    client = distance_mqtt.client()

    stream = StreamLease()

    def on_control(_topic: str, payload: str) -> None:
        nonlocal active
        try:
            data = json.loads(payload or "{}")
            if data.get("cmd") == "stream":
                stream.handle(bool(data.get("active", True)), time.monotonic())
            elif "active" in data:
                active = bool(data["active"])
        except Exception as exc:  # noqa: BLE001
            log.warning("control message error: %s", exc)

    active = True
    client.subscribe(constants.CONTROL, on_control)
    distance_mqtt.serve_config()

    client.publish(constants.STATUS, {"active": active, "available": True},
                    retain=True)

    try:
        while True:
            cfg = load_config()
            window_s = max(cfg["avg_window_ms"] / 1000, constants.SAMPLE_INTERVAL_S)
            samples = []
            window_deadline = time.monotonic() + window_s

            # Collect pings for the whole window before publishing — one
            # averaged reading per window, not one per ping, is what tames
            # the jitter a single HC-SR04 ping has.
            while True:
                time.sleep(constants.SAMPLE_INTERVAL_S)
                if not active:
                    break
                echo_s = read_echo_seconds(GPIO)
                cm = clean_reading(cm_from_echo(echo_s), cfg["max_range_cm"]) \
                    if echo_s is not None else None
                samples.append(cm)
                if time.monotonic() >= window_deadline:
                    break

            if not active:
                continue

            cm = average_reading(samples)
            tracker.warn_cm = cfg["warn_cm"]
            tracker.absent_after_n = max(1, cfg["absent_after_n"])
            event = tracker.update(cm)

            # Live readings only while the dev console holds a stream
            # lease — presence below is published either way.
            if stream.is_active(time.monotonic()):
                client.publish(constants.READING, {
                    "cm": cm,
                    "available": cm is not None,
                    "near": cm is not None and cm <= cfg["warn_cm"],
                }, qos=0)

            if event == "PRESENT":
                log.info("PRESENT — publishing to %s", constants.GLOBAL_PRESENCE)
                client.publish(constants.GLOBAL_PRESENCE, "present")
            elif event == "ABSENT":
                log.info("ABSENT — publishing to %s", constants.GLOBAL_PRESENCE)
                client.publish(constants.GLOBAL_PRESENCE, "absent")
    except KeyboardInterrupt:
        log.info("daemon stopped")
        return 0
    finally:
        client.publish(constants.STATUS, {"active": False, "available": False},
                        retain=True)
        client.stop()
        try:
            GPIO.cleanup()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    raise SystemExit(main())
