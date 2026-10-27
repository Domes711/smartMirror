"""Broker connection and message handling for the display feature.

Topics owned by display, plus the one cross-feature topic it listens on.
on_message() dispatches by topic suffix and calls service.py for the actual
work; nothing here knows about ddcutil.
"""

import json
import logging

from features.display import service
from features.display.constants import (
    BASE, STATE, CONTROL_WILDCARD, POWER, BRIGHTNESS, CONTRAST, RGB,
    PRESET, MODE, E2, GET_STATE, PROFILE_CHANGED, SERVICE_NAME,
)

log = logging.getLogger(__name__)


class DisplayMqtt:
    """Owns the broker connection: subscribes, dispatches, publishes."""

    def __init__(self, client):
        self.client = client
        self.last_state = {}

    def subscribe_all(self):
        self.client.subscribe(CONTROL_WILDCARD, self.on_message)
        self.client.subscribe(PROFILE_CHANGED, self.on_message)
        log.info("Subscribed to %s and %s", CONTROL_WILDCARD, PROFILE_CHANGED)

    def publish_state(self, force: bool = False):
        """Publish the monitor's actual current state, if it changed."""
        state = service.get_monitor_state()
        if force or state != self.last_state:
            self.client.publish(STATE, state, retain=True)
            self.last_state = state
            log.info("Published state: %s", state)

    def on_message(self, topic: str, payload: str):
        log.info("Received: %s = %s", topic, payload)

        try:
            if topic == PROFILE_CHANGED:
                profile = (payload or "default").strip() or "default"
                service.apply_profile(profile)
                self.publish_state(force=True)
                return

            if topic.endswith("/power"):
                service.set_power(payload)

            elif topic.endswith("/brightness"):
                service.set_brightness(int(payload))

            elif topic.endswith("/contrast"):
                service.set_contrast(int(payload))

            elif topic.endswith("/rgb"):
                service.set_rgb(json.loads(payload))

            elif topic.endswith("/preset"):
                service.set_preset(payload)

            elif topic.endswith("/mode"):
                service.set_mode(payload)

            elif topic.endswith("/e2"):
                service.set_e2(int(payload))

            elif topic.endswith("/get_state"):
                self.publish_state(force=True)
                return

            self.publish_state(force=True)

        except json.JSONDecodeError as e:
            log.error("Invalid JSON payload: %s", e)
        except Exception as e:
            log.error("Error processing message: %s", e)
