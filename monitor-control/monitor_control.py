#!/usr/bin/env python3
"""
monitor_control.py - MQTT-controlled monitor settings daemon

Subscribes to MQTT topics to control Dell U2515H monitor via DDC/CI (ddcutil).
Publishes current monitor state to MQTT.

Topics:
  smartmirror/monitor/control/brightness    - set brightness (0-100)
  smartmirror/monitor/control/contrast      - set contrast (0-100)
  smartmirror/monitor/control/power         - on/off/standby
  smartmirror/monitor/control/mode          - standard/movie/games
  smartmirror/monitor/control/preset        - 5000K/6500K/7500K/9300K/10000K/user1/user2
  smartmirror/monitor/control/rgb           - {r: 0-100, g: 0-100, b: 0-100}
  smartmirror/monitor/control/e2            - custom feature (0-25)
  smartmirror/monitor/state                 - published state (JSON)
"""

import json
import subprocess
import time
import logging
from typing import Dict, Any, Optional
import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [monitor_control] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# MQTT Configuration
MQTT_BROKER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_BASE_TOPIC = "smartmirror/monitor"

# VCP Feature codes
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
    "5000K": "0x04",
    "6500K": "0x05",
    "7500K": "0x06",
    "9300K": "0x08",
    "10000K": "0x09",
    "user1": "0x0B",
    "user2": "0x0C"
}

DISPLAY_MODES = {
    "standard": "0x00",
    "mixed": "0x02",
    "movie": "0x03",
    "games": "0x05"
}

POWER_MODES = {
    "on": "1",
    "off": "4",
    "standby": "4"
}


class MonitorController:
    def __init__(self):
        self.client = mqtt.Client(client_id="monitor_control")
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.last_state = {}

    def ddcutil_setvcp(self, feature: str, value: str, noverify: bool = False) -> bool:
        """Execute ddcutil setvcp command"""
        try:
            cmd = ["ddcutil", "setvcp", feature, value]
            if noverify:
                cmd.append("--noverify")

            logger.info(f"Setting VCP {feature} = {value}")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            if result.returncode != 0:
                logger.error(f"ddcutil setvcp failed: {result.stderr}")
                return False

            return True
        except subprocess.TimeoutExpired:
            logger.error(f"ddcutil timeout for feature {feature}")
            return False
        except Exception as e:
            logger.error(f"ddcutil error: {e}")
            return False

    def ddcutil_getvcp(self, feature: str) -> Optional[int]:
        """Execute ddcutil getvcp command and return current value"""
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
        except Exception as e:
            logger.error(f"getvcp error for {feature}: {e}")
            return None

    def get_monitor_state(self) -> Dict[str, Any]:
        """Read current monitor state"""
        state = {
            "brightness": self.ddcutil_getvcp(VCP_BRIGHTNESS),
            "contrast": self.ddcutil_getvcp(VCP_CONTRAST),
            "red": self.ddcutil_getvcp(VCP_RED_GAIN),
            "green": self.ddcutil_getvcp(VCP_GREEN_GAIN),
            "blue": self.ddcutil_getvcp(VCP_BLUE_GAIN),
            "timestamp": time.time()
        }
        return state

    def publish_state(self, force=False):
        """Publish current monitor state to MQTT"""
        state = self.get_monitor_state()
        if force or state != self.last_state:
            self.client.publish(f"{MQTT_BASE_TOPIC}/state", json.dumps(state), retain=True)
            self.last_state = state
            logger.info(f"Published state: {state}")

    def on_connect(self, client, userdata, flags, rc):
        logger.info(f"Connected to MQTT broker with result code {rc}")

        # Subscribe to control topics
        topics = [
            f"{MQTT_BASE_TOPIC}/control/brightness",
            f"{MQTT_BASE_TOPIC}/control/contrast",
            f"{MQTT_BASE_TOPIC}/control/power",
            f"{MQTT_BASE_TOPIC}/control/mode",
            f"{MQTT_BASE_TOPIC}/control/preset",
            f"{MQTT_BASE_TOPIC}/control/rgb",
            f"{MQTT_BASE_TOPIC}/control/e2",
            f"{MQTT_BASE_TOPIC}/control/refresh"
        ]

        for topic in topics:
            client.subscribe(topic)
            logger.info(f"Subscribed to {topic}")

        # Publish initial state (force to ensure it's retained)
        self.publish_state(force=True)

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode()

        logger.info(f"Received: {topic} = {payload}")

        try:
            if topic.endswith("/brightness"):
                value = int(payload)
                if 0 <= value <= 100:
                    self.ddcutil_setvcp(VCP_BRIGHTNESS, str(value))

            elif topic.endswith("/contrast"):
                value = int(payload)
                if 0 <= value <= 100:
                    self.ddcutil_setvcp(VCP_CONTRAST, str(value))

            elif topic.endswith("/power"):
                mode = payload.lower()
                if mode == "on":
                    self.ddcutil_setvcp(VCP_POWER, POWER_MODES["on"], noverify=True)
                elif mode in ["off", "standby"]:
                    self.ddcutil_setvcp(VCP_POWER, POWER_MODES["off"])

            elif topic.endswith("/mode"):
                mode = payload.lower()
                if mode in DISPLAY_MODES:
                    self.ddcutil_setvcp(VCP_DISPLAY_MODE, DISPLAY_MODES[mode])

            elif topic.endswith("/preset"):
                preset = payload.lower()
                if preset in COLOR_PRESETS:
                    self.ddcutil_setvcp(VCP_COLOR_PRESET, COLOR_PRESETS[preset])

            elif topic.endswith("/rgb"):
                rgb = json.loads(payload)
                if "r" in rgb:
                    self.ddcutil_setvcp(VCP_RED_GAIN, str(rgb["r"]))
                if "g" in rgb:
                    self.ddcutil_setvcp(VCP_GREEN_GAIN, str(rgb["g"]))
                if "b" in rgb:
                    self.ddcutil_setvcp(VCP_BLUE_GAIN, str(rgb["b"]))

            elif topic.endswith("/e2"):
                value = int(payload)
                if 0 <= value <= 25:
                    hex_val = f"0x{value:02X}"
                    self.ddcutil_setvcp(VCP_CUSTOM_E2, hex_val, noverify=True)

            elif topic.endswith("/refresh"):
                pass  # Just publish state

            # Publish updated state after any change
            time.sleep(0.5)  # Give monitor time to update
            self.publish_state()

        except Exception as e:
            logger.error(f"Error processing message: {e}")

    def run(self):
        """Main loop"""
        logger.info("Starting monitor control daemon")

        self.client.connect(MQTT_BROKER, MQTT_PORT, 60)
        self.client.loop_start()

        try:
            # Publish state every 30 seconds
            while True:
                time.sleep(30)
                self.publish_state()
        except KeyboardInterrupt:
            logger.info("Shutting down")
        finally:
            self.client.loop_stop()
            self.client.disconnect()


if __name__ == "__main__":
    controller = MonitorController()
    controller.run()
