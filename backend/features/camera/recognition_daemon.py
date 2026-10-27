#!/usr/bin/env python3
"""Event-driven face recognition daemon for MMM-Profile.

Listens to MQTT presence events from the radar daemon. When presence
is detected, performs face recognition and publishes the result.

Flow:
1. Radar detects presence → smartmirror/radar/presence = "present"
2. This daemon receives event → starts face recognition scan
3. Result published to → smartmirror/camera/recognition = {"user": "Domes"|null}
4. MMM-Profile receives both events and updates UI

Reset command:
- smartmirror/control/reset → publishes {"user": null} to reset state

Usage:
    python3 face_reco_daemon.py
    python3 face_reco_daemon.py --max-duration 5  # Scan for 5s max
"""

import argparse
import logging
import os
import pickle
import sys
import time
import threading

# backend/ on sys.path so `shared` / `features` import the same way from a
# systemd unit, a test run, or `python3 -m features.camera.recognition_daemon`.
sys.path.insert(0, os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from shared.mqtt_client import MqttClient
from shared import paths
from features.camera import constants as topics

DEFAULT_ENCODINGS = paths.ENCODINGS_PATH
DEFAULT_MAX_DURATION = 3.0  # seconds to scan for faces (aggressive optimization)
DEFAULT_TOLERANCE = 0.6
FRAME_INTERVAL = 0.3  # seconds between face detection attempts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s face_reco_daemon: %(message)s",
)
log = logging.getLogger("face_reco_daemon")


def load_known(pickle_path: str):
    """Load (encodings, names) from the trained faces pickle."""
    with open(pickle_path, "rb") as f:
        data = pickle.load(f)
    return data["encodings"], data["names"]


def recognize_stream(picam, max_duration, known_encodings, known_names, tolerance):
    """Scan camera stream for up to max_duration seconds, return first match.

    Args:
        picam: Already-running Picamera2 instance (reused for speed)

    Returns (name, kind):
        ("Domes", "match") on a hit,
        (None, "unknown_face") if face detected but doesn't match,
        (None, "no_face") if no face detected within timeout.
    """
    try:
        import face_recognition
    except ImportError as exc:
        log.error("Import failed: %s", exc)
        return None, "error"

    start_time = time.time()
    last_attempt = 0
    frames_checked = 0
    detected_unknown = False

    log.info("Scanning for faces (max %.1fs)...", max_duration)

    while True:
        elapsed = time.time() - start_time

        # Timeout check
        if elapsed >= max_duration:
            kind = "unknown_face" if detected_unknown else "no_face"
            log.info("Timeout after %.1fs, result: %s", elapsed, kind)
            return None, kind

        # Rate limiting - but process as fast as possible
        if elapsed - last_attempt < FRAME_INTERVAL:
            time.sleep(0.01)  # Minimal sleep for CPU breathing room
            continue

        last_attempt = elapsed
        frames_checked += 1

        # Grab frame
        frame = picam.capture_array()

        # Detect faces - aggressive optimization:
        # - model="hog" (faster than cnn on CPU)
        # - number_of_times_to_upsample=0 (skip upsampling for speed)
        locations = face_recognition.face_locations(
            frame,
            model="hog",
            number_of_times_to_upsample=0
        )
        if not locations:
            continue

        detected_unknown = True

        # Encode faces
        encodings = face_recognition.face_encodings(frame, locations)
        if not encodings:
            continue

        # Check for match
        for enc in encodings:
            matches = face_recognition.compare_faces(
                known_encodings, enc, tolerance=tolerance
            )
            for name, hit in zip(known_names, matches):
                if hit:
                    log.info("Recognized %s after %.1fs (%d frames)",
                            name, elapsed, frames_checked)
                    return name, "match"


class FaceRecoDaemon:
    """Event-driven face recognition daemon with persistent camera."""

    def __init__(self, mqtt_client, known_encodings, known_names,
                 max_duration, tolerance):
        self.mqtt_client = mqtt_client
        self.known_encodings = known_encodings
        self.known_names = known_names
        self.max_duration = max_duration
        self.tolerance = tolerance
        self.scanning_lock = threading.Lock()
        self.is_scanning = False
        self.picam = None
        self._init_camera()

    def _init_camera(self):
        """Initialize camera once and keep it running."""
        try:
            from picamera2 import Picamera2
            self.picam = Picamera2()
            # Medium resolution for balance between speed and accuracy
            config = self.picam.create_preview_configuration(
                main={"size": (320, 240), "format": "RGB888"}
            )
            self.picam.configure(config)
            self.picam.start()
            # Short warmup and discard first few frames (they can be blurry)
            time.sleep(0.3)
            for _ in range(3):
                self.picam.capture_array()
            log.info("Camera initialized and ready (320x240, balanced)")
        except Exception as exc:
            log.error("Failed to initialize camera: %s", exc)
            self.picam = None

    def cleanup(self):
        """Stop camera on daemon shutdown."""
        if self.picam:
            try:
                self.picam.stop()
                log.info("Camera stopped")
            except Exception as exc:
                log.error("Error stopping camera: %s", exc)

    def on_presence_event(self, payload: str):
        """Handle presence MQTT event."""
        if payload == "present":
            log.info("Presence detected, starting face recognition")
            # Start scan in background thread to not block MQTT
            thread = threading.Thread(target=self._perform_scan, daemon=True)
            thread.start()
        elif payload == "absent":
            log.info("Presence lost")
            # We don't need to do anything - just wait for next presence

    def on_reset(self):
        """Handle reset/init command - reset to default state."""
        log.info("RESET command received, resetting to default state")
        # Publish unknown user to reset MMM-Profile
        self.mqtt_client.publish(topics.RECOGNITION, {"user": None})
        # Note: we don't stop scanning if in progress, just publish reset state

    def _perform_scan(self):
        """Perform face recognition scan (runs in background thread)."""
        with self.scanning_lock:
            if self.is_scanning:
                log.info("Scan already in progress, skipping")
                return
            self.is_scanning = True

        try:
            if not self.picam:
                log.error("Camera not initialized, cannot scan")
                self.mqtt_client.publish(topics.RECOGNITION, {"user": None})
                return

            name, kind = recognize_stream(
                self.picam,
                self.max_duration,
                self.known_encodings,
                self.known_names,
                self.tolerance
            )

            if name:
                self.mqtt_client.publish(topics.RECOGNITION, {"user": name})
            else:
                log.info("No recognized face (%s)", kind)
                self.mqtt_client.publish(topics.RECOGNITION, {"user": None})

        except Exception as exc:
            log.exception("Face recognition failed: %s", exc)
            self.mqtt_client.publish(topics.RECOGNITION, {"user": None})
        finally:
            self.is_scanning = False


def _config_defaults() -> dict:
    """Scan timeout + tolerance from `camera_config`, falling back to the
    constants above when the DB is unreachable — recognition must still run
    rather than refuse to start."""
    out = {"max_duration": DEFAULT_MAX_DURATION,
           "tolerance": DEFAULT_TOLERANCE}
    try:
        from data import device_config
        from shared import db
        db.init()
        cfg = device_config.resolve("camera")
        if cfg.get("recognition_timeout_s") is not None:
            out["max_duration"] = float(cfg["recognition_timeout_s"])
        if cfg.get("recognition_tolerance") is not None:
            out["tolerance"] = float(cfg["recognition_tolerance"])
    except Exception as exc:  # noqa: BLE001
        log.warning("camera_config unreadable, using constants: %s", exc)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Event-driven face recognition daemon for MMM-Profile."
    )
    parser.add_argument("--encodings", default=DEFAULT_ENCODINGS,
                        help="path to encoded_faces.pickle")
    # Defaults come from `camera_config`; the flags still override, so a
    # one-off run with a different tolerance needs no DB write.
    cfg = _config_defaults()
    parser.add_argument("--max-duration", type=float,
                        default=cfg["max_duration"],
                        help=f"max scan duration in seconds (default: {cfg['max_duration']})")
    parser.add_argument("--tolerance", type=float, default=cfg["tolerance"],
                        help="face_recognition tolerance")
    args = parser.parse_args()

    # Load encodings
    if not os.path.exists(args.encodings):
        log.error("encodings file not found: %s", args.encodings)
        return 1

    known_encodings, known_names = load_known(args.encodings)
    if not known_encodings:
        log.error("encodings file is empty")
        return 1

    log.info("Loaded %d face encodings: %s", len(known_encodings),
             ", ".join(set(known_names)))

    # The shared client reconnects with backoff and re-subscribes, so a
    # broker restart no longer leaves the daemon deaf to presence events.
    mqtt_client = MqttClient("camera_recognition_daemon")

    # Create daemon instance
    daemon = FaceRecoDaemon(
        mqtt_client, known_encodings, known_names,
        args.max_duration, args.tolerance
    )

    def on_presence(_topic: str, payload: str) -> None:
        daemon.on_presence_event(payload)

    def on_reset(_topic: str, _payload: str) -> None:
        daemon.on_reset()

    mqtt_client.subscribe(topics.PRESENCE, on_presence)
    mqtt_client.subscribe(topics.RESET, on_reset)

    try:
        log.info("Starting face recognition daemon (event-driven mode)")
        mqtt_client.start()
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Daemon stopped")
        return 0
    finally:
        daemon.cleanup()
        mqtt_client.stop()


if __name__ == "__main__":
    sys.exit(main())
