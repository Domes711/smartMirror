"""LD2450 presence-detection daemon.

Reads radar frames from UART, filters targets to a rectangular zone,
tracks PRESENT/ABSENT state, drives the display via a GPIO-toggled relay
and notifies the mirror over MQTT.

Face recognition runs independently as a separate daemon (face_reco_daemon.py).

The parser and PresenceTracker are deliberately platform-independent
(no `serial` or `RPi.GPIO` import at module level) so the test suite
runs anywhere. setup_gpio / read_frame / main lazy-import the
hardware-only modules.
"""

import json
import math
import os
import struct
import sys
import threading
import time
import logging

# backend/ on sys.path so `shared` / `features` import the same way from a
# systemd unit, a test run, or `python3 -m features.radar.daemon`.
sys.path.insert(0, os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('radar')

FRAME_HEADER = bytes([0xAA, 0xFF, 0x03, 0x00])  # Engineering mode
FRAME_FOOTER = bytes([0x55, 0xCC])  # Engineering mode
FRAME_LEN = 30  # header(4) + data(24) + footer(2)

GPIO_BUTTON = 17
PRESENCE_X_MM = 400      # half-width of detection zone (+-40cm)
PRESENCE_Y_MM = 1500     # depth of detection zone (1.5m)
ABSENCE_TIMEOUT_SEC = 60 # spec 2026-04-26: 60 s instead of the v1 120 s
BUTTON_PULSE_MS = 100    # confirmed working on the live monitor

# --- noise / ghost mitigation -------------------------------------------
# The LD2450 throws occasional spurious single-frame targets. These filters
# tame them; tweak the constants to taste.
ENTER_CONSECUTIVE_FRAMES = 3  # in-zone frames required before declaring PRESENT
MAX_RANGE_MM = 6000           # drop implausibly far targets (likely ghosts)
MIN_SPEED = 0                 # drop targets below this raw speed (0 = disabled;
                              #   LD2450 speed encoding is non-standard — use care)

# Position smoothing (EMA + deadband). Tames jitter/drift so a standing person
# reports a steady x/y — used for both the map and presence/zone detection.
SMOOTH_ALPHA = 0.3            # EMA factor: higher = snappier, lower = smoother
SMOOTH_DEADBAND_MM = 60       # ignore moves smaller than this (anti micro-drift)
SMOOTH_GATE_MM = 600          # max distance to associate a raw target to a track
SMOOTH_MAX_MISSES = 5         # drop a track after this many frames unseen

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

TARGET_PUB_INTERVAL = 0.1   # s — throttle live target broadcasts (~10 Hz)

EXCL_RADIUS_MM = 250     # drop targets within this of a learned ghost spot
BASELINE_GRID_MM = 150   # quantize baseline ghost points to this grid


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
        x = struct.unpack_from('<H', payload, i)[0]      # unsigned 16-bit X (mm)
        y_cm = payload[i+2]                               # Y in centimeters!
        y = y_cm * 10                                     # convert cm to mm
        speed = struct.unpack_from('<H', payload, i+4)[0] # unsigned 16-bit speed
        # Bytes i+3, i+6, i+7 - unknown/reserved

        # Filter out empty targets (0,0)
        if x != 0 or y != 0:
            targets.append((x, y, speed))

    return targets


def calculate_distance(x: int, y: int) -> float:
    """Calculate Euclidean distance in mm from radar origin."""
    return math.sqrt(x ** 2 + y ** 2)


def clean_targets(targets: list, max_range_mm: int = MAX_RANGE_MM,
                  min_speed: int = MIN_SPEED) -> list:
    """Drop empty / implausible / too-slow targets before tracking & broadcast.

    This removes the spurious single-frame ghosts the LD2450 occasionally emits
    (origin (0,0), absurd distances, and — if min_speed > 0 — near-stationary
    blips).
    """
    cleaned = []
    for x, y, speed in targets:
        if x == 0 and y == 0:
            continue
        if y <= 0 or y > max_range_mm:
            continue
        if min_speed and speed < min_speed:
            continue
        cleaned.append((x, y, speed))
    return cleaned


# --- calibration: config + coordinate helpers --------------------------

# Calibration now lives in the central SQLite DB (features/radar/config.py),
# not `radar_config.json`. The defaults are duplicated here as plain data so
# the parser/tracker tests stay import-light (no sqlite, no `shared` package)
# — config.DEFAULTS is the same shape and is asserted equal in the tests.
DEFAULT_CONFIG = {
    "zone": {"x": PRESENCE_X_MM, "y": PRESENCE_Y_MM},
    "x_offset": 0,            # mm subtracted from x to center the origin
    "invert_x": False,        # flip left/right if mirrored
    "enter_frames": ENTER_CONSECUTIVE_FRAMES,
    "max_range_mm": MAX_RANGE_MM,
    "min_speed": MIN_SPEED,
    "alpha": SMOOTH_ALPHA,
    "deadband_mm": SMOOTH_DEADBAND_MM,
    "exclusions": [],         # [[x,y],...] learned ghost spots to drop
}
_CONFIG_KEYS = tuple(DEFAULT_CONFIG)


def _clone(cfg: dict) -> dict:
    return json.loads(json.dumps(cfg))


def load_config() -> dict:
    from features.radar import config as radar_config
    return radar_config.load()


def save_config(cfg: dict) -> None:
    from features.radar import config as radar_config
    radar_config.save(cfg)


def apply_axis(targets: list, x_offset: int = 0, invert_x: bool = False) -> list:
    """Apply mirror + origin offset so the coordinate frame matches reality."""
    out = []
    for x, y, s in targets:
        nx = -x if invert_x else x
        out.append((nx - x_offset, y, s))
    return out


def drop_excluded(targets: list, exclusions: list,
                  radius_mm: int = EXCL_RADIUS_MM) -> list:
    """Drop targets sitting on a learned ghost spot (empty-room baseline)."""
    if not exclusions:
        return list(targets)
    out = []
    for x, y, s in targets:
        if any(math.hypot(x - ex, y - ey) <= radius_mm for ex, ey in exclusions):
            continue
        out.append((x, y, s))
    return out


def build_exclusions(points: list, grid_mm: int = BASELINE_GRID_MM) -> list:
    """Quantize baseline ghost points to a grid and de-duplicate."""
    seen, out = set(), []
    for x, y in points:
        cell = (round(x / grid_mm) * grid_mm, round(y / grid_mm) * grid_mm)
        if cell not in seen:
            seen.add(cell)
            out.append([cell[0], cell[1]])
    return out


class TargetSmoother:
    """EMA position smoothing with a deadband + nearest-neighbour association.

    Each physical target keeps a stable smoothed track across frames:
      - a raw target is matched to the nearest existing track within `gate_mm`;
      - the track is nudged toward it by `alpha` (EMA), but only if it moved more
        than `deadband_mm` (so a standing person's coords stay rock steady);
      - unmatched tracks age out after `max_misses` frames (brief hold avoids
        flicker on a dropped frame).
    Output is a list of smoothed (x, y, speed) tuples — suitable for the map and
    for presence/zone detection.
    """

    def __init__(self, alpha: float = SMOOTH_ALPHA,
                 deadband_mm: int = SMOOTH_DEADBAND_MM,
                 gate_mm: int = SMOOTH_GATE_MM,
                 max_misses: int = SMOOTH_MAX_MISSES):
        self.alpha = alpha
        self.deadband_mm = deadband_mm
        self.gate_mm = gate_mm
        self.max_misses = max_misses
        self._tracks = []  # [{x, y, speed, misses}]

    def update(self, targets: list) -> list:
        matched = set()
        new_tracks = []
        for rx, ry, rspeed in targets:
            best_i, best_d = None, None
            for i, tr in enumerate(self._tracks):
                if i in matched:
                    continue
                d = math.hypot(rx - tr["x"], ry - tr["y"])
                if d <= self.gate_mm and (best_d is None or d < best_d):
                    best_i, best_d = i, d
            if best_i is None:
                new_tracks.append({"x": float(rx), "y": float(ry),
                                   "speed": rspeed, "misses": 0})
            else:
                tr = self._tracks[best_i]
                dx, dy = rx - tr["x"], ry - tr["y"]
                if math.hypot(dx, dy) > self.deadband_mm:   # outside deadband
                    tr["x"] += self.alpha * dx
                    tr["y"] += self.alpha * dy
                tr["speed"] = rspeed
                tr["misses"] = 0
                matched.add(best_i)

        # age unmatched tracks, drop the stale ones, then add new ones
        for i, tr in enumerate(self._tracks):
            if i not in matched:
                tr["misses"] += 1
        self._tracks = [tr for i, tr in enumerate(self._tracks)
                        if tr["misses"] <= self.max_misses]
        self._tracks.extend(new_tracks)

        return [(int(round(tr["x"])), int(round(tr["y"])), tr["speed"])
                for tr in self._tracks]


class PresenceTracker:
    def __init__(self, x_mm: int, y_mm: int, timeout_sec: int,
                 enter_consecutive: int = 1):
        self.x_mm = x_mm      # half-width of detection zone (+-x_mm)
        self.y_mm = y_mm      # depth of detection zone (0 to y_mm)
        self.timeout_sec = timeout_sec
        self.enter_consecutive = max(1, enter_consecutive)  # debounce frames
        self._present = False
        self._last_seen = None    # time when presence was last detected
        self._streak = 0          # consecutive in-zone frames (entry debounce)

    @property
    def is_present(self) -> bool:
        return self._present

    def update(self, targets: list):
        """
        Feed new targets. Returns 'PRESENT', 'ABSENT', or None.
        - 'PRESENT': someone has been in the zone for `enter_consecutive` frames
        - 'ABSENT': no one in zone for timeout_sec seconds
        - None: no state change

        The entry debounce (`enter_consecutive`) suppresses one-off ghost frames
        so a single spurious target can't flip the mirror on.
        """
        in_range = any(
            abs(x) <= self.x_mm and 0 < y <= self.y_mm
            for x, y, _ in targets
            if not (x == 0 and y == 0)
        )

        now = time.monotonic()

        if in_range:
            self._last_seen = now
            self._streak += 1
            if not self._present and self._streak >= self.enter_consecutive:
                self._present = True
                return 'PRESENT'
            return None

        # Nothing in range
        self._streak = 0
        if self._present:
            elapsed = (now - self._last_seen) if self._last_seen else self.timeout_sec
            if elapsed >= self.timeout_sec:
                self._present = False
                self._last_seen = None
                return 'ABSENT'
        return None


class RadarState:
    """Thread-safe holder for the live config + calibration jobs.

    The MQTT thread feeds control commands via handle(); the main serial loop
    reads snapshot(), records baseline frames via feed_baseline(), and stores
    the latest smoothed targets via set_last() (used by set_center/set_axis).
    """

    def __init__(self, config: dict):
        self.lock = threading.Lock()
        self.config = config
        self.last_targets = []
        self._baseline_deadline = None
        self._baseline_points = []
        self._dirty = True   # publish config once at startup

    def snapshot(self) -> dict:
        with self.lock:
            return self.config

    def set_last(self, targets: list) -> None:
        with self.lock:
            self.last_targets = list(targets)

    def consume_dirty(self) -> bool:
        with self.lock:
            d, self._dirty = self._dirty, False
            return d

    def feed_baseline(self, targets: list, now: float):
        """Accumulate ghost points while a baseline job is running; finalize on time."""
        with self.lock:
            if self._baseline_deadline is None:
                return
            for x, y, _ in targets:
                self._baseline_points.append((x, y))
            if now >= self._baseline_deadline:
                excl = build_exclusions(self._baseline_points)
                self.config = {**self.config, "exclusions": excl}
                log.info("baseline done: %d samples -> %d exclusions",
                         len(self._baseline_points), len(excl))
                self._baseline_deadline = None
                self._baseline_points = []
                self._dirty = True

    @staticmethod
    def _nearest_center(targets: list):
        best = None
        for t in targets:
            if best is None or abs(t[0]) < abs(best[0]):
                best = t
        return best

    def handle(self, payload: dict, now: float) -> None:
        cmd = (payload or {}).get("cmd")
        with self.lock:
            cfg = dict(self.config)
            if cmd == "get_config":
                pass  # just re-publish (dirty below)
            elif cmd == "set_config":
                new = payload.get("config", {}) or {}
                for k in _CONFIG_KEYS:
                    if k in new:
                        cfg[k] = new[k]
            elif cmd == "set_center":
                tgt = self._nearest_center(self.last_targets)
                if tgt is not None:
                    cfg["x_offset"] = cfg.get("x_offset", 0) + tgt[0]
            elif cmd == "set_axis":
                tgt = self._nearest_center(self.last_targets)
                if tgt is not None and tgt[0] < 0:
                    cfg["invert_x"] = not cfg.get("invert_x", False)
            elif cmd == "baseline":
                self._baseline_deadline = now + float(payload.get("seconds", 10))
                self._baseline_points = []
                cfg["exclusions"] = []   # fresh learn
            elif cmd == "reset":
                cfg = _clone(DEFAULT_CONFIG)
            else:
                return
            self.config = cfg
            self._dirty = True


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
    from shared import db
    from shared.mqtt_client import MqttClient
    from features.radar import mqtt as topics

    db.init()
    GPIO = setup_gpio()

    config = load_config()
    state = RadarState(config)
    tracker = PresenceTracker(
        x_mm=config["zone"]["x"],
        y_mm=config["zone"]["y"],
        timeout_sec=ABSENCE_TIMEOUT_SEC,
        enter_consecutive=config["enter_frames"],
    )
    smoother = TargetSmoother(alpha=config["alpha"],
                              deadband_mm=config["deadband_mm"])

    def on_control(_topic: str, payload: str) -> None:
        try:
            state.handle(json.loads(payload or "{}"), time.monotonic())
        except Exception as exc:  # noqa: BLE001
            log.warning("control message error: %s", exc)

    # The shared client reconnects on its own and re-subscribes, so a broker
    # restart no longer leaves the daemon deaf to calibration commands (the
    # old client connected once and returned 1 on failure, killing the unit).
    client = MqttClient("radar_daemon")
    client.subscribe(topics.CONTROL, on_control)
    client.start()

    def publish_config():
        client.publish(topics.CONFIG, state.snapshot(), retain=True)

    def apply_config():
        cfg = state.snapshot()
        smoother.alpha = cfg["alpha"]
        smoother.deadband_mm = cfg["deadband_mm"]
        tracker.x_mm = cfg["zone"]["x"]
        tracker.y_mm = cfg["zone"]["y"]
        tracker.enter_consecutive = max(1, cfg["enter_frames"])

    try:
        with serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1) as ser:
            log.info("daemon started, listening on %s @ %d baud",
                     SERIAL_DEVICE, SERIAL_BAUD)
            last_pub = 0.0
            while True:
                frame = read_frame(ser)
                now = time.monotonic()
                cfg = state.snapshot()

                # raw -> axis correction -> range/speed clean -> baseline learn
                # -> exclusions -> smoothing
                corrected = clean_targets(
                    apply_axis(parse_frame(frame),
                               cfg["x_offset"], cfg["invert_x"]),
                    cfg["max_range_mm"], cfg["min_speed"])
                state.feed_baseline(corrected, now)
                filtered = drop_excluded(corrected, cfg.get("exclusions", []))
                targets = smoother.update(filtered)
                state.set_last(targets)
                event = tracker.update(targets)

                # Broadcast live target positions for the radar console map
                # (throttled, fire-and-forget, no logging spam).
                if now - last_pub >= TARGET_PUB_INTERVAL:
                    last_pub = now
                    client.publish(topics.TARGETS, {
                        "targets": [[x, y, s] for (x, y, s) in targets],
                        "present": tracker.is_present,
                        "zone": cfg["zone"],
                    }, qos=0)

                # config changed (calibration) -> apply live, persist, publish
                if state.consume_dirty():
                    apply_config()
                    save_config(state.snapshot())
                    publish_config()

                if event == "PRESENT":
                    log.info("PRESENT — display ON, publishing to MQTT")
                    pulse_button(GPIO)
                    client.publish(topics.PRESENCE, "present")
                elif event == "ABSENT":
                    log.info("ABSENT — display OFF, publishing to MQTT")
                    pulse_button(GPIO)
                    client.publish(topics.PRESENCE, "absent")
    except KeyboardInterrupt:
        log.info("daemon stopped")
        return 0
    finally:
        client.stop()
        try:
            GPIO.cleanup()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    raise SystemExit(main())
