"""All constants for the display feature: VCP feature codes (DDC/CI) and the
MQTT topics it publishes/subscribes to. No logic — just names and values.
"""

# --------------------------------------------------------------------------- #
# DDC/CI — VESA VCP feature codes, used by driver.py
# --------------------------------------------------------------------------- #
VCP_BRIGHTNESS = "10"
VCP_CONTRAST = "12"
VCP_COLOR_PRESET = "14"
VCP_RED_GAIN = "16"
VCP_GREEN_GAIN = "18"
VCP_BLUE_GAIN = "1A"
VCP_POWER = "D6"
VCP_DISPLAY_MODE = "DC"
VCP_CUSTOM_E2 = "E2"

COLOR_PRESETS = {
    "5000k": "0x04",
    "6500k": "0x05",
    "7500k": "0x06",
    "9300k": "0x08",
    "10000k": "0x09",
    "user1": "0x0B",
    "user2": "0x0C",
}

DISPLAY_MODES = {
    "standard": "0x00",
    "movie": "0x03",
    "games": "0x05",
}

POWER_MODES = {
    "on": "0x01",      # DPM: On, DPMS: Off
    "standby": "0x04",  # DPM: Off, DPMS: Off
}

# --------------------------------------------------------------------------- #
# MQTT topics, used by mqtt.py
# --------------------------------------------------------------------------- #
BASE = "smartmirror/display"

STATE = f"{BASE}/state"                       # out: full monitor state (retained)

# The daemon subscribes to the wildcard and routes on the topic suffix, so
# every command below is `<BASE>/control/<name>` with a plain (non-JSON)
# payload. This is the interface the app's Zrcadlo/Dev screens publish to.
CONTROL_WILDCARD = f"{BASE}/control/#"

POWER = f"{BASE}/control/power"               # "on" | "standby"
BRIGHTNESS = f"{BASE}/control/brightness"     # "0".."100"
CONTRAST = f"{BASE}/control/contrast"         # "0".."100"
RGB = f"{BASE}/control/rgb"
PRESET = f"{BASE}/control/preset"
MODE = f"{BASE}/control/mode"
E2 = f"{BASE}/control/e2"
GET_STATE = f"{BASE}/control/get_state"       # in: publish STATE now

# in: cross-feature topic, published whenever the recognized/active profile
# changes. Every feature that needs to react to a new profile subscribes to
# this; display re-applies that person's monitor_config overrides.
PROFILE_CHANGED = "smartmirror/control/profile_changed"

SERVICE_NAME = "display"
