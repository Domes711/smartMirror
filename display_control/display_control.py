#!/usr/bin/env python3
"""Display control daemon.

Listens to MQTT topic smartmirror/display/control and controls the monitor:
- Power toggle via GPIO17 (simulates power button press)
- Brightness control via DDC/CI (requires ddcutil)

MQTT messages:
  smartmirror/display/control {"command": "toggle"}
  smartmirror/display/control {"command": "brightness", "value": 0-100}
"""

import json
import logging
import os
import subprocess
import time

import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
log = logging.getLogger("display_control")

GPIO_BUTTON = 17
BUTTON_PULSE_MS = 100  # same as ld2450 daemon

MQTT_BROKER = os.environ.get("MQTT_BROKER", "127.0.0.1")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC = "smartmirror/display/control"


def setup_gpio():
    """Setup GPIO for display power control."""
    try:
        import RPi.GPIO as GPIO

        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        GPIO.setup(GPIO_BUTTON, GPIO.IN)  # idle high-Z
        log.info("GPIO%d ready (idle INPUT)", GPIO_BUTTON)
        return GPIO
    except ImportError:
        log.warning("RPi.GPIO not available - GPIO control disabled")
        return None


def pulse_button(GPIO):
    """Pull SIG to GND for BUTTON_PULSE_MS ms to simulate a button press."""
    if GPIO is None:
        log.warning("GPIO not available - skipping button pulse")
        return

    GPIO.setup(GPIO_BUTTON, GPIO.OUT, initial=GPIO.LOW)
    time.sleep(BUTTON_PULSE_MS / 1000)
    GPIO.setup(GPIO_BUTTON, GPIO.IN)
    log.info("Display power button pulsed")


def set_brightness(value: int):
    """Set display brightness via DDC/CI.

    Args:
        value: Brightness percentage (0-100)
    """
    try:
        # ddcutil setvcp 10 <value> sets brightness
        # Note: value for ddcutil is also 0-100
        # --noverify: Some Dell monitors (like U2515H) fail verification
        subprocess.run(
            ["ddcutil", "--noverify", "setvcp", "10", str(value)],
            check=True,
            capture_output=True,
            timeout=5,
        )
        log.info("Brightness set to %d%%", value)
    except FileNotFoundError:
        log.warning("ddcutil not found - brightness control disabled")
    except subprocess.CalledProcessError as e:
        log.error("Failed to set brightness: %s", e.stderr.decode())
    except subprocess.TimeoutExpired:
        log.error("ddcutil timeout - display may not support DDC/CI")
    except Exception as e:
        log.error("Brightness control error: %s", e)


def main() -> int:
    """Main daemon loop."""
    GPIO = setup_gpio()

    mqtt_client = mqtt.Client(client_id="display_control_daemon")

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            log.info("MQTT connected to %s:%d", MQTT_BROKER, MQTT_PORT)
            client.subscribe(MQTT_TOPIC)
            log.info("Subscribed to %s", MQTT_TOPIC)
        else:
            log.error("MQTT connection failed with code %d", rc)

    def on_message(client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            command = payload.get("command")

            if command == "toggle":
                log.info("Received toggle command")
                pulse_button(GPIO)
            elif command == "brightness":
                value = payload.get("value", 50)
                # Clamp to 0-100
                value = max(0, min(100, int(value)))
                log.info("Received brightness command: %d%%", value)
                set_brightness(value)
            else:
                log.warning("Unknown command: %s", command)

        except json.JSONDecodeError as e:
            log.error("Invalid JSON payload: %s", e)
        except Exception as e:
            log.error("Message handler error: %s", e)

    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message

    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        log.info("Display control daemon started")
        mqtt_client.loop_forever()
    except KeyboardInterrupt:
        log.info("Display control daemon stopped")
        return 0
    except Exception as e:
        log.error("Fatal error: %s", e)
        return 1
    finally:
        mqtt_client.disconnect()
        if GPIO:
            try:
                GPIO.cleanup()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
