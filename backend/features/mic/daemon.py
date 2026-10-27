#!/usr/bin/env python3
"""mic daemon - entrypoint only: `python3 -m features.mic.daemon`.

Starts the MQTT connection (features.mic.mqtt) and the HTTP server for the
one route MQTT cannot carry: the test recording's WAV bytes. All business
logic — config, test recording, satellite start/stop arbitration — lives in
service.py.
"""

import logging

from shared import db, paths
from shared.http import Router, serve

from . import http as mic_http
from .mqtt import serve_all

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s mic: %(message)s")
log = logging.getLogger("mic")

HOST = "127.0.0.1"
PORT = 8005


def main() -> int:
    paths.ensure_var_dirs()
    db.init()

    serve_all()

    router = Router()
    mic_http.mount(router)
    serve(router, HOST, PORT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
