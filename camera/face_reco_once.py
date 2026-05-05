"""On-demand single-shot face recognition for MMM-Profile.

Triggered by ld2450_daemon when presence is detected. Opens the RPi
camera, grabs one frame, runs face_recognition against the trained
pickle (~/camera/encoded_faces.pickle), and POSTs the result to
MMM-Profile's HTTP endpoint.

Exits 0 always: any failure mode posts `user_unknown` rather than
crashing, so the daemon's subprocess slot stays clean.

Usage:
    python3 face_reco_once.py
    python3 face_reco_once.py --encodings /path/to/encoded_faces.pickle
    python3 face_reco_once.py --endpoint http://127.0.0.1:8080/mmm-profile/event
"""

import argparse
import json
import logging
import os
import pickle
import sys
import time
import urllib.request

DEFAULT_ENCODINGS = "/home/admin/camera/encoded_faces.pickle"
DEFAULT_ENDPOINT = "http://127.0.0.1:8080/mmm-profile/event"
DEFAULT_WARMUP_SEC = 0.5
DEFAULT_TOLERANCE = 0.6

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s face_reco_once: %(message)s",
)
log = logging.getLogger("face_reco_once")


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
    except Exception as exc:  # noqa: BLE001 -- we never want to crash on POST
        log.warning("POST failed: %s", exc)


def load_known(pickle_path: str):
    """Load (encodings, names) from the trained faces pickle."""
    with open(pickle_path, "rb") as f:
        data = pickle.load(f)
    return data["encodings"], data["names"]


def grab_frame(warmup_sec: float):
    """Open the RPi camera, grab one frame, return as HxWx3 RGB array."""
    # Lazy import so the script can be syntax-checked in environments
    # without picamera2 installed.
    from picamera2 import Picamera2

    picam = Picamera2()
    config = picam.create_still_configuration(main={"size": (640, 480)})
    picam.configure(config)
    picam.start()
    try:
        # Brief warm-up so auto-exposure / white-balance settle.
        time.sleep(max(0.0, warmup_sec))
        return picam.capture_array()
    finally:
        picam.stop()


def recognize(frame, known_encodings, known_names, tolerance: float):
    """First name whose stored encoding matches a face in the frame.

    Returns (name, kind):
        ("Domes", "match") on a hit,
        (None, "unknown_face") if a face is detected but doesn't match,
        (None, "no_face") if no face is detected at all.
    """
    import face_recognition

    locations = face_recognition.face_locations(frame, model="hog")
    if not locations:
        return None, "no_face"
    encodings = face_recognition.face_encodings(frame, locations)
    for enc in encodings:
        matches = face_recognition.compare_faces(
            known_encodings, enc, tolerance=tolerance
        )
        for name, hit in zip(known_names, matches):
            if hit:
                return name, "match"
    return None, "unknown_face"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Single-shot face recognition for MMM-Profile."
    )
    parser.add_argument("--encodings", default=DEFAULT_ENCODINGS,
                        help="path to encoded_faces.pickle")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT,
                        help="MMM-Profile HTTP endpoint")
    parser.add_argument("--warmup-sec", type=float, default=DEFAULT_WARMUP_SEC,
                        help="camera warm-up before grabbing the frame")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE,
                        help="face_recognition.compare_faces tolerance")
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

        frame = grab_frame(args.warmup_sec)
        name, kind = recognize(
            frame, known_encodings, known_names, args.tolerance
        )
        if name:
            log.info("recognized %s (%s)", name, kind)
            post_event(args.endpoint,
                       {"event": "user_recognized", "user": name})
        else:
            log.info("no recognized face (%s)", kind)
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
