#!/usr/bin/env python3
"""ai_modules daemon - entrypoint only.

Starts the MQTT connection (features.ai_modules.mqtt) and the HTTP server
(features.ai_modules.http) for the one route MQTT cannot carry. All business
logic lives in service.py — see docs/features/ai_modules.md.
"""

import logging
import os
import sys

# backend/ on sys.path so `shared` imports the same way from a systemd unit,
# a test run, or `python3 -m features.ai_modules.daemon`.
sys.path.insert(0, os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from shared import db, paths
from shared.http import Router, serve
from shared.mqtt_client import MqttClient
from features.ai_modules import http as ai_http
from features.ai_modules.mqtt import AiModulesMqtt

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [ai_modules] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger(__name__)

HOST = "127.0.0.1"
PORT = 8004


def main() -> int:
    log.info("Starting ai_modules daemon")

    paths.ensure_var_dirs()
    db.init()

    # The shared client connects asynchronously with retry, so the daemon
    # survives a broker that starts after it.
    client = MqttClient("ai_modules_daemon")
    AiModulesMqtt(client).serve_all()
    client.start()

    router = Router()
    ai_http.mount(router)
    # /module-preview/<name>/demo.html (+ its .js/.css) for the Workshop's
    # live iframe preview — the working copy, not the installed module.
    serve(router, HOST, PORT, static={
        "/module-preview": paths.AI_MODULES_WORKSPACE_DIR,
    })   # blocks — this is what keeps the process alive
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
