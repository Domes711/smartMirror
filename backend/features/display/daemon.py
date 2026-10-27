#!/usr/bin/env python3
"""Display control daemon - entrypoint only.

Starts the MQTT connection (features.display.mqtt) and keeps the process
alive. All business logic lives in service.py, all hardware I/O in driver.py
— see backend/README.md and docs/features/refactor_display_feature.md.
"""

import logging
import os
import sys
import time

# backend/ on sys.path so `shared` imports the same way from a systemd unit,
# a test run, or `python3 -m features.display.daemon`.
sys.path.insert(0, os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from shared.mqtt_client import MqttClient
from features.display import driver
from features.display.mqtt import DisplayMqtt

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [display] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger(__name__)


def run() -> None:
    log.info("Starting display control daemon")

    # The shared client connects asynchronously with retry, so the daemon
    # survives a broker that starts after it.
    client = MqttClient("display_daemon")
    handler = DisplayMqtt(client)

    driver.init_monitor()
    handler.subscribe_all()
    client.start()
    handler.publish_state(force=True)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Display control daemon stopped")
    finally:
        client.stop()


def main() -> int:
    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
