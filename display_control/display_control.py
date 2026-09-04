#!/usr/bin/env python3
"""Display control daemon - comprehensive monitor control via MQTT.

Controls Dell U2515H monitor via DDC/CI (ddcutil).

Topics:
  smartmirror/display/control/power           - on/standby (DDC/CI)
  smartmirror/display/control/brightness      - 0-100
  smartmirror/display/control/contrast        - 0-100
  smartmirror/display/control/rgb             - {"r": 0-100, "g": 0-100, "b": 0-100}
  smartmirror/display/control/preset          - 5000K/6500K/7500K/9300K/10000K/user1/user2
  smartmirror/display/control/mode            - standard/movie/games
  smartmirror/display/control/e2              - 0-25 (custom feature)
  smartmirror/display/control/get_state       - request state publish
  smartmirror/display/state                   - published state (JSON, retained)
"""

import json
import logging
import os
import subprocess
import time
from typing import Dict, Any, Optional

import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [display_control] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger(__name__)

# MQTT Configuration
MQTT_BROKER = os.environ.get("MQTT_BROKER", "127.0.0.1")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_BASE_TOPIC = "smartmirror/display"

# VCP Feature codes (VESA DDC/CI standard)
VCP_BRIGHTNESS = "10"
VCP_CONTRAST = "12"
VCP_COLOR_PRESET = "14"
VCP_RED_GAIN = "16"
VCP_GREEN_GAIN = "18"
VCP_BLUE_GAIN = "1A"
VCP_POWER = "D6"
VCP_DISPLAY_MODE = "DC"
VCP_CUSTOM_E2 = "E2"

# Mappings
COLOR_PRESETS = {
    "5000k": "0x04",
    "6500k": "0x05",
    "7500k": "0x06",
    "9300k": "0x08",
    "10000k": "0x09",
    "user1": "0x0B",
    "user2": "0x0C"
}

DISPLAY_MODES = {
    "standard": "0x00",
    "movie": "0x03",
    "games": "0x05"
}

POWER_MODES = {
    "on": "0x01",      # DPM: On, DPMS: Off
    "standby": "0x04"  # DPM: Off, DPMS: Off
}


class DisplayController:
    def __init__(self):
        self.client = mqtt.Client(client_id="display_control_daemon")
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.last_state = {}

        # Initialize monitor to Standard mode (disables dynamic contrast)
        self.init_monitor()

    def init_monitor(self):
        """Initialize monitor - set to Standard mode to enable brightness control.

        Dell monitors with dynamic contrast enabled block manual brightness changes.
        Setting Display Mode to Standard (VCP DC = 0x00) disables dynamic contrast.
        """
        try:
            subprocess.run(
                ["ddcutil", "--noverify", "setvcp", VCP_DISPLAY_MODE, DISPLAY_MODES["standard"]],
                check=True,
                capture_output=True,
                timeout=5,
            )
            log.info("Monitor set to Standard mode (dynamic contrast disabled)")
        except FileNotFoundError:
            log.debug("ddcutil not found - skipping monitor init")
        except subprocess.CalledProcessError as e:
            log.warning("Failed to set monitor mode: %s", e.stderr.decode())
        except Exception as e:
            log.warning("Monitor init error: %s", e)

    def ddcutil_setvcp(self, feature: str, value: str, noverify: bool = True) -> bool:
        """Execute ddcutil setvcp command."""
        try:
            cmd = ["ddcutil", "setvcp", feature, value]
            if noverify:
                cmd.insert(1, "--noverify")

            log.info(f"Setting VCP {feature} = {value}")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            if result.returncode != 0:
                log.error(f"ddcutil setvcp failed: {result.stderr}")
                return False

            return True
        except subprocess.TimeoutExpired:
            log.error(f"ddcutil timeout for feature {feature}")
            return False
        except FileNotFoundError:
            log.warning("ddcutil not found")
            return False
        except Exception as e:
            log.error(f"ddcutil error: {e}")
            return False

    def ddcutil_getvcp(self, feature: str) -> Optional[int]:
        """Execute ddcutil getvcp command and return current value."""
        try:
            cmd = ["ddcutil", "getvcp", feature]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            if result.returncode != 0:
                return None

            # Parse output like: "VCP code 0x10 (Brightness): current value = 100, max value = 100"
            for line in result.stdout.split('\n'):
                if "current value" in line:
                    parts = line.split("current value")[1].split(",")[0]
                    value = int(parts.strip().replace("=", "").strip())
                    return value

            return None
        except FileNotFoundError:
            return None
        except Exception as e:
            log.error(f"getvcp error for {feature}: {e}")
            return None

    def get_monitor_state(self) -> Dict[str, Any]:
        """Read current monitor state."""
        state = {
            "brightness": self.ddcutil_getvcp(VCP_BRIGHTNESS),
            "contrast": self.ddcutil_getvcp(VCP_CONTRAST),
            "red": self.ddcutil_getvcp(VCP_RED_GAIN),
            "green": self.ddcutil_getvcp(VCP_GREEN_GAIN),
            "blue": self.ddcutil_getvcp(VCP_BLUE_GAIN),
            "power": self.ddcutil_getvcp(VCP_POWER),
            "timestamp": time.time()
        }
        return state

    def publish_state(self, force=False):
        """Publish current monitor state to MQTT."""
        state = self.get_monitor_state()
        if force or state != self.last_state:
            self.client.publish(f"{MQTT_BASE_TOPIC}/state", json.dumps(state), retain=True)
            self.last_state = state
            log.info(f"Published state: {state}")

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            log.info(f"MQTT connected to {MQTT_BROKER}:{MQTT_PORT}")
        else:
            log.error(f"MQTT connection failed with code {rc}")
            return

        # Subscribe to all control topics
        topics = [
            f"{MQTT_BASE_TOPIC}/control/power",
            f"{MQTT_BASE_TOPIC}/control/brightness",
            f"{MQTT_BASE_TOPIC}/control/contrast",
            f"{MQTT_BASE_TOPIC}/control/rgb",
            f"{MQTT_BASE_TOPIC}/control/preset",
            f"{MQTT_BASE_TOPIC}/control/mode",
            f"{MQTT_BASE_TOPIC}/control/e2",
            f"{MQTT_BASE_TOPIC}/control/get_state"
        ]

        for topic in topics:
            client.subscribe(topic)
            log.info(f"Subscribed to {topic}")

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode()

        log.info(f"Received: {topic} = {payload}")

        try:
            # DDC/CI Power control
            if topic.endswith("/power"):
                mode = payload.lower()
                if mode == "on":
                    self.ddcutil_setvcp(VCP_POWER, POWER_MODES["on"])
                    # Wait for monitor to fully power on
                    time.sleep(2)
                    # Reinitialize to Standard mode after power on
                    self.init_monitor()
                elif mode == "standby":
                    self.ddcutil_setvcp(VCP_POWER, POWER_MODES["standby"])

            # Brightness
            elif topic.endswith("/brightness"):
                value = int(payload)
                if 0 <= value <= 100:
                    self.ddcutil_setvcp(VCP_BRIGHTNESS, str(value))

            # Contrast
            elif topic.endswith("/contrast"):
                value = int(payload)
                if 0 <= value <= 100:
                    self.ddcutil_setvcp(VCP_CONTRAST, str(value))

            # RGB gains
            elif topic.endswith("/rgb"):
                rgb = json.loads(payload)
                if "r" in rgb:
                    self.ddcutil_setvcp(VCP_RED_GAIN, str(rgb["r"]))
                if "g" in rgb:
                    self.ddcutil_setvcp(VCP_GREEN_GAIN, str(rgb["g"]))
                if "b" in rgb:
                    self.ddcutil_setvcp(VCP_BLUE_GAIN, str(rgb["b"]))

            # Color preset
            elif topic.endswith("/preset"):
                preset = payload.lower()
                if preset in COLOR_PRESETS:
                    self.ddcutil_setvcp(VCP_COLOR_PRESET, COLOR_PRESETS[preset])

            # Display mode
            elif topic.endswith("/mode"):
                mode = payload.lower()
                if mode in DISPLAY_MODES:
                    self.ddcutil_setvcp(VCP_DISPLAY_MODE, DISPLAY_MODES[mode])

            # Custom feature E2
            elif topic.endswith("/e2"):
                value = int(payload)
                if 0 <= value <= 25:
                    hex_val = f"0x{value:02X}"
                    self.ddcutil_setvcp(VCP_CUSTOM_E2, hex_val)

            # State request
            elif topic.endswith("/get_state"):
                # Respond immediately with current state
                self.publish_state(force=True)
                return  # Don't wait or publish again

            # Publish updated state after any change (except get_state)
            if not topic.endswith("/get_state"):
                time.sleep(0.5)  # Give monitor time to update
                self.publish_state(force=True)

        except json.JSONDecodeError as e:
            log.error(f"Invalid JSON payload: {e}")
        except Exception as e:
            log.error(f"Error processing message: {e}")

    def run(self):
        """Main daemon loop."""
        log.info("Starting display control daemon")

        self.client.connect(MQTT_BROKER, MQTT_PORT, 60)
        self.client.loop_start()

        try:
            # Just keep running and respond to messages
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            log.info("Display control daemon stopped")
        finally:
            self.client.loop_stop()
            self.client.disconnect()


def main() -> int:
    """Main entry point."""
    controller = DisplayController()
    controller.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
