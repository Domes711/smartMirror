"""Entrypoint for the camera supervisor: `python3 -m features.camera.daemon`.

Owns the camera hardware lock and serves the stream/enrollment API on :8001.
The production recognition daemon (`features.camera.recognition_daemon`) is
a *separate* process under its own unit — the camera is exclusive, so
arbitration means starting and stopping that unit, not importing it.

All business logic lives in service.py; transport dispatch in mqtt.py
(RPC) and http.py (binary streams + the JSON migration shim).
"""

import argparse
import logging

from shared import db, paths
from shared.http import Router, serve

from . import http as camera_http, mqtt as camera_mqtt, service
from .supervisor import (DEFAULT_HEIGHT, DEFAULT_TOLERANCE, DEFAULT_WIDTH,
                         Supervisor)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s camera: %(message)s")
log = logging.getLogger("camera")

HOST = "127.0.0.1"
PORT = 8001


def main() -> int:
    ap = argparse.ArgumentParser(description="Smart mirror camera supervisor")
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    ap.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    ap.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    ap.add_argument("--encodings", default=paths.ENCODINGS_PATH)
    args = ap.parse_args()

    paths.ensure_var_dirs()
    db.init()

    sup = Supervisor(width=args.width, height=args.height,
                     tolerance=args.tolerance, encodings=args.encodings)

    service.mount(sup)
    camera_mqtt.serve_all()

    router = Router()
    camera_http.mount(router, sup)

    # Restore the persisted mode. Done after mount() so the first state
    # change is already published to MQTT.
    sup.apply_mode(sup.load_mode())

    # Retained state the app subscribes to instead of polling: publish it now
    # so a subscriber connecting later gets a value without asking.
    service.publish_initial_state()

    try:
        serve(router, args.host, args.port)
    finally:
        sup.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
