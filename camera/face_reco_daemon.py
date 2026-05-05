#!/usr/bin/env python3
"""Event-driven face recognition daemon for MMM-Profile.

Listens to MQTT presence events from the radar daemon. When presence
is detected, performs face recognition and publishes the result.

Flow:
1. Radar detects presence → smartmirror/radar/presence = "present"
2. This daemon receives event → starts face recognition scan
3. Result published to → smartmirror/camera/recognition = {"user": "Domes"|null}
4. MMM-Profile receives both events and updates UI

Usage:
    python3 face_reco_daemon.py
    python3 face_reco_daemon.py --max-duration 5  # Scan for 5s max
"""

import argparse
import json
import logging
import os
import pickle
import sys
import time
import threading
import paho.mqtt.client as mqtt

DEFAULT_ENCODINGS = "/home/admin/smartMirror/camera/encoded_faces.pickle"
DEFAULT_MQTT_BROKER = "127.0.0.1"
DEFAULT_MQTT_PORT = 1883
MQTT_TOPIC_PRESENCE = "smartmirror/radar/presence"
MQTT_TOPIC_RECOGNITION = "smartmirror/camera/recognition"
DEFAULT_MAX_DURATION = 10.0  # seconds to scan for faces
DEFAULT_TOLERANCE = 0.6
FRAME_INTERVAL = 0.3  # seconds between face detection attempts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s face_reco_daemon: %(message)s",
)
log = logging.getLogger("face_reco_daemon")


def mqtt_publish(client: mqtt.Client, topic: str, payload: dict) -> None:
    """Publish recognition result to MQTT."""
    try:
        data = json.dumps(payload)
        result = client.publish(topic, data, qos=1)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            log.info("MQTT published: %s -> %s", topic, data)
        else:
            log.warning("MQTT publish failed: rc=%d", result.rc)
    except Exception as exc:
        log.warning("MQTT publish error: %s", exc)


def load_known(pickle_path: str):
    """Load (encodings, names) from the trained faces pickle."""
    with open(pickle_path, "rb") as f:
        data = pickle.load(f)
    return data["encodings"], data["names"]


def recognize_stream(max_duration, known_encodings, known_names, tolerance):
    """Scan camera stream for up to max_duration seconds, return first match.

    Returns (name, kind):
        ("Domes", "match") on a hit,
        (None, "unknown_face") if face detected but doesn't match,
        (None, "no_face") if no face detected within timeout.
    """
    try:
        from picamera2 import Picamera2
        import face_recognition
    except ImportError as exc:
        log.error("Import failed: %s", exc)
        return None, "error"

    picam = Picamera2()
    config = picam.create_preview_configuration(
        main={"size": (640, 480), "format": "RGB888"}
    )
    picam.configure(config)
    picam.start()

    try:
        # Warmup
        time.sleep(0.5)

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

            # Rate limiting
            if elapsed - last_attempt < FRAME_INTERVAL:
                time.sleep(0.05)
                continue

            last_attempt = elapsed
            frames_checked += 1

            # Grab frame
            frame = picam.capture_array()

            # Detect faces
            locations = face_recognition.face_locations(frame, model="hog")
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

    finally:
        picam.stop()


class FaceRecoDaemon:
    """Event-driven face recognition daemon."""

    def __init__(self, mqtt_client, known_encodings, known_names,
                 max_duration, tolerance):
        self.mqtt_client = mqtt_client
        self.known_encodings = known_encodings
        self.known_names = known_names
        self.max_duration = max_duration
        self.tolerance = tolerance
        self.scanning_lock = threading.Lock()
        self.is_scanning = False

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

    def _perform_scan(self):
        """Perform face recognition scan (runs in background thread)."""
        with self.scanning_lock:
            if self.is_scanning:
                log.info("Scan already in progress, skipping")
                return
            self.is_scanning = True

        try:
            name, kind = recognize_stream(
                self.max_duration,
                self.known_encodings,
                self.known_names,
                self.tolerance
            )

            if name:
                mqtt_publish(self.mqtt_client, MQTT_TOPIC_RECOGNITION,
                           {"user": name})
            else:
                log.info("No recognized face (%s)", kind)
                mqtt_publish(self.mqtt_client, MQTT_TOPIC_RECOGNITION,
                           {"user": None})

        except Exception as exc:
            log.exception("Face recognition failed: %s", exc)
            mqtt_publish(self.mqtt_client, MQTT_TOPIC_RECOGNITION,
                       {"user": None})
        finally:
            self.is_scanning = False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Event-driven face recognition daemon for MMM-Profile."
    )
    parser.add_argument("--encodings", default=DEFAULT_ENCODINGS,
                        help="path to encoded_faces.pickle")
    parser.add_argument("--mqtt-broker", default=DEFAULT_MQTT_BROKER,
                        help=f"MQTT broker (default: {DEFAULT_MQTT_BROKER})")
    parser.add_argument("--mqtt-port", type=int, default=DEFAULT_MQTT_PORT,
                        help=f"MQTT port (default: {DEFAULT_MQTT_PORT})")
    parser.add_argument("--max-duration", type=float, default=DEFAULT_MAX_DURATION,
                        help=f"max scan duration in seconds (default: {DEFAULT_MAX_DURATION})")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE,
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

    # Setup MQTT client
    mqtt_client = mqtt.Client(client_id="face_reco_daemon")

    # Create daemon instance
    daemon = FaceRecoDaemon(
        mqtt_client, known_encodings, known_names,
        args.max_duration, args.tolerance
    )

    # Setup MQTT callbacks
    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            log.info("MQTT connected to %s:%d", args.mqtt_broker, args.mqtt_port)
            client.subscribe(MQTT_TOPIC_PRESENCE)
            log.info("Subscribed to %s", MQTT_TOPIC_PRESENCE)
        else:
            log.error("MQTT connection failed: rc=%d", rc)

    def on_message(client, userdata, msg):
        try:
            payload = msg.payload.decode('utf-8')
            log.info("MQTT message: %s = %s", msg.topic, payload)
            if msg.topic == MQTT_TOPIC_PRESENCE:
                daemon.on_presence_event(payload)
        except Exception as exc:
            log.error("Error handling MQTT message: %s", exc)

    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message

    try:
        mqtt_client.connect(args.mqtt_broker, args.mqtt_port, 60)
        log.info("Starting face recognition daemon (event-driven mode)")
        mqtt_client.loop_forever()
    except KeyboardInterrupt:
        log.info("Daemon stopped")
        return 0
    except Exception as exc:
        log.error("MQTT error: %s", exc)
        return 1
    finally:
        mqtt_client.disconnect()


if __name__ == "__main__":
    sys.exit(main())
