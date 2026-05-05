#!/usr/bin/env python3
"""On-demand face recognition for MMM-Profile with live stream scanning.

Triggered by ld2450_daemon when presence is detected. Opens the RPi
camera and continuously scans for faces over a period (default 10s),
returning as soon as a face is recognized or timing out with user_unknown.

This multi-frame approach is much more reliable than single-shot recognition,
handling momentary occlusions, bad angles, or lighting variations.

Usage:
    python3 face_reco_once.py
    python3 face_reco_once.py --preview          # Show live camera view (for testing)
    python3 face_reco_once.py --max-duration 5   # Scan for 5 seconds max
    python3 face_reco_once.py --encodings /path/to/encoded_faces.pickle
"""

import argparse
import json
import logging
import os
import pickle
import sys
import time
import urllib.request

DEFAULT_ENCODINGS = "/home/admin/smartMirror/camera/encoded_faces.pickle"
DEFAULT_ENDPOINT = "http://127.0.0.1:8080/mmm-profile/event"
DEFAULT_MAX_DURATION = 10.0  # seconds to scan for faces
DEFAULT_WARMUP_SEC = 0.5
DEFAULT_TOLERANCE = 0.6
FRAME_INTERVAL = 0.3  # seconds between face detection attempts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s face_reco: %(message)s",
)
log = logging.getLogger("face_reco")


def post_event(endpoint: str, payload: dict) -> None:
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            log.info("POSTed %s -> HTTP %s", payload.get("event"), resp.status)
    except Exception as exc:  # noqa: BLE001 -- never crash on POST
        log.warning("POST failed: %s", exc)


def load_known(pickle_path: str):
    """Load (encodings, names) from the trained faces pickle."""
    with open(pickle_path, "rb") as f:
        data = pickle.load(f)
    return data["encodings"], data["names"]


def recognize_stream(
    max_duration: float,
    known_encodings,
    known_names,
    tolerance: float,
    warmup_sec: float,
    show_preview: bool = False,
):
    """Scan camera stream for up to max_duration seconds, return first match.

    Returns (name, kind, elapsed_time):
        ("Domes", "match", 2.3) on a hit,
        (None, "unknown_face", 5.1) if face detected but doesn't match,
        (None, "no_face", 10.0) if no face detected within timeout.
    """
    try:
        from picamera2 import Picamera2
        import face_recognition
        if show_preview:
            import cv2
    except ImportError as exc:
        log.error("Import failed: %s", exc)
        return None, "error", 0.0

    picam = Picamera2()
    config = picam.create_preview_configuration(
        main={"size": (640, 480), "format": "RGB888"}
    )
    picam.configure(config)
    picam.start()

    try:
        # Warm-up
        time.sleep(max(0.0, warmup_sec))

        start_time = time.time()
        last_attempt = 0
        frames_checked = 0
        detected_unknown = False  # Track if we've seen any face at all

        log.info("Scanning for faces (max %.1fs)...", max_duration)

        while True:
            elapsed = time.time() - start_time

            # Timeout check
            if elapsed >= max_duration:
                kind = "unknown_face" if detected_unknown else "no_face"
                log.info("Timeout after %.1fs, result: %s", elapsed, kind)
                return None, kind, elapsed

            # Grab frame
            frame = picam.capture_array()

            # Show preview if requested
            if show_preview:
                display_frame = frame.copy()
                # Add overlay
                elapsed_int = int(elapsed)
                remaining = max(0, int(max_duration - elapsed))
                cv2.putText(display_frame, f"Scanning... {remaining}s", (10, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.putText(display_frame, f"Frames: {frames_checked}", (10, 60),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
                cv2.imshow("Face Recognition - Press 'q' to abort", display_frame)

                # Allow early abort
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    log.warning("Aborted by user")
                    if show_preview:
                        cv2.destroyAllWindows()
                    return None, "aborted", elapsed

            # Rate limiting: only check every FRAME_INTERVAL seconds
            if elapsed - last_attempt < FRAME_INTERVAL:
                time.sleep(0.05)
                continue

            last_attempt = elapsed
            frames_checked += 1

            # Detect faces
            locations = face_recognition.face_locations(frame, model="hog")
            if not locations:
                continue  # No face in this frame, keep scanning

            detected_unknown = True  # We've seen at least one face

            # Draw boxes in preview
            if show_preview:
                display_frame = frame.copy()
                for (top, right, bottom, left) in locations:
                    cv2.rectangle(display_frame, (left, top), (right, bottom),
                                 (0, 255, 0), 2)
                cv2.putText(display_frame, "Face detected!", (10, 90),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                cv2.imshow("Face Recognition - Press 'q' to abort", display_frame)
                cv2.waitKey(1)

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

                        # Show success in preview
                        if show_preview:
                            display_frame = frame.copy()
                            for (top, right, bottom, left) in locations:
                                cv2.rectangle(display_frame, (left, top),
                                            (right, bottom), (0, 255, 0), 3)
                            cv2.putText(display_frame, f"Welcome {name}!", (10, 120),
                                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
                            cv2.imshow("Face Recognition - Press 'q' to abort", display_frame)
                            cv2.waitKey(2000)  # Show for 2s
                            cv2.destroyAllWindows()

                        return name, "match", elapsed

            # No match in this frame, continue scanning

    finally:
        picam.stop()
        if show_preview:
            try:
                import cv2
                cv2.destroyAllWindows()
            except:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Multi-frame face recognition for MMM-Profile."
    )
    parser.add_argument("--encodings", default=DEFAULT_ENCODINGS,
                        help="path to encoded_faces.pickle")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT,
                        help="MMM-Profile HTTP endpoint")
    parser.add_argument("--max-duration", type=float, default=DEFAULT_MAX_DURATION,
                        help=f"max seconds to scan for faces (default: {DEFAULT_MAX_DURATION})")
    parser.add_argument("--warmup-sec", type=float, default=DEFAULT_WARMUP_SEC,
                        help="camera warm-up before scanning")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE,
                        help="face_recognition.compare_faces tolerance")
    parser.add_argument("--preview", action="store_true",
                        help="show live camera preview (for testing)")
    args = parser.parse_args()

    try:
        if not os.path.exists(args.encodings):
            log.error("encodings file not found: %s", args.encodings)
            post_event(args.endpoint, {"event": "user_unknown"})
            return 0

        known_encodings, known_names = load_known(args.encodings)
        if not known_encodings:
            log.warning("encodings file is empty")
            post_event(args.endpoint, {"event": "user_unknown"})
            return 0

        log.info("Loaded %d face encodings: %s", len(known_encodings),
                 ", ".join(set(known_names)))

        name, kind, elapsed = recognize_stream(
            args.max_duration,
            known_encodings,
            known_names,
            args.tolerance,
            args.warmup_sec,
            args.preview,
        )

        if name:
            post_event(args.endpoint, {"event": "user_recognized", "user": name})
        else:
            log.info("No recognized face (%s after %.1fs)", kind, elapsed)
            post_event(args.endpoint, {"event": "user_unknown"})

        return 0

    except Exception as exc:  # noqa: BLE001 -- always exit clean
        log.exception("face recognition failed: %s", exc)
        try:
            post_event(args.endpoint, {"event": "user_unknown"})
        except Exception:  # noqa: BLE001
            pass
        return 0


if __name__ == "__main__":
    sys.exit(main())
