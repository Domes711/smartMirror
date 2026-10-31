"""Broker connection and message handling for the display feature.

Topics owned by display, plus the one cross-feature topic it listens on.
on_message() dispatches by topic suffix and calls service.py for the actual
work; nothing here knows about ddcutil.
"""

import json
import logging
import threading

from features.display import service
from features.display.constants import (
    BASE, STATE, CONTROL_WILDCARD, POWER, BRIGHTNESS, CONTRAST, RGB,
    PRESET, MODE, E2, GET_STATE, OFF_DELAY, PROFILE_CHANGED, GLOBAL_PRESENCE,
    SERVICE_NAME,
)

log = logging.getLogger(__name__)


class DisplayMqtt:
    """Owns the broker connection: subscribes, dispatches, publishes."""

    def __init__(self, client):
        self.client = client
        self.last_state = {}
        # Pending "stand by after off_delay_s" timer from the last ABSENT —
        # cancelled by a PRESENT that arrives before it fires, so a person
        # who steps away and back inside the delay never sees the display
        # drop out.
        self._off_timer: threading.Timer | None = None

    def subscribe_all(self):
        self.client.subscribe(CONTROL_WILDCARD, self.on_message)
        self.client.subscribe(PROFILE_CHANGED, self.on_message)
        self.client.subscribe(GLOBAL_PRESENCE, self.on_message)
        log.info("Subscribed to %s, %s and %s",
                 CONTROL_WILDCARD, PROFILE_CHANGED, GLOBAL_PRESENCE)

    def publish_state(self, force: bool = False):
        """Publish the monitor's actual current state, if it changed."""
        state = service.get_monitor_state()
        if force or state != self.last_state:
            self.client.publish(STATE, state, retain=True)
            self.last_state = state
            log.info("Published state: %s", state)

    def _on_presence(self, payload: str):
        """GLOBAL_PRESENCE wakes the monitor immediately on "present", but
        only *schedules* standby on "absent" — off_delay_s later, so someone
        stepping just out of sensor range and back doesn't see the display
        drop out. A "present" before the timer fires cancels it."""
        if self._off_timer is not None:
            self._off_timer.cancel()
            self._off_timer = None

        if payload == "present":
            service.set_power("on")
            self.publish_state(force=True)
            return

        delay = service.get_off_delay_s()

        def fire():
            service.set_power("standby")
            self.publish_state(force=True)

        self._off_timer = threading.Timer(delay, fire)
        self._off_timer.daemon = True
        self._off_timer.start()
        log.info("absent — standing by in %ds unless presence returns", delay)

    def on_message(self, topic: str, payload: str):
        log.info("Received: %s = %s", topic, payload)

        try:
            if topic == PROFILE_CHANGED:
                profile = (payload or "default").strip() or "default"
                service.apply_profile(profile)
                self.publish_state(force=True)
                return

            if topic == GLOBAL_PRESENCE:
                self._on_presence(payload.strip())
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

            elif topic.endswith("/off_delay"):
                service.set_off_delay_s(int(payload))

            elif topic.endswith("/get_state"):
                self.publish_state(force=True)
                return

            self.publish_state(force=True)

        except json.JSONDecodeError as e:
            log.error("Invalid JSON payload: %s", e)
        except Exception as e:
            log.error("Error processing message: %s", e)
