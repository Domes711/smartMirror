"""Business logic for the display feature, on demand.

Called by mqtt.py in response to a request; calls driver.py for the actual
hardware I/O and data.device_config for the resolved/stored settings. Knows
nothing about MQTT topics or ddcutil subprocess details.
"""

import logging
import time
from typing import Any, Dict

from data import device_config
from features.display import driver

log = logging.getLogger(__name__)

# monitor_config seeds brightness_day/brightness_night (day vs. night, not a
# live VCP readout), so applying a profile means picking one of those, not
# mapping a key 1:1 onto a VCP feature. Night is a placeholder choice until
# day/night switching exists (see backend/README.md "Where to pick up").
def _apply_brightness(cfg: Dict[str, Any]) -> None:
    value = cfg.get("brightness_day")
    if value is not None:
        driver.ddcutil_setvcp(driver.VCP_BRIGHTNESS, str(value))


_HW_APPLIERS = (_apply_brightness,)


def get_monitor_state() -> Dict[str, Any]:
    """Read the monitor's actual current state via the driver."""
    return {
        "brightness": driver.ddcutil_getvcp(driver.VCP_BRIGHTNESS),
        "contrast": driver.ddcutil_getvcp(driver.VCP_CONTRAST),
        "red": driver.ddcutil_getvcp(driver.VCP_RED_GAIN),
        "green": driver.ddcutil_getvcp(driver.VCP_GREEN_GAIN),
        "blue": driver.ddcutil_getvcp(driver.VCP_BLUE_GAIN),
        "power": driver.ddcutil_getvcp(driver.VCP_POWER),
        "timestamp": time.time(),
    }


def set_power(mode: str) -> bool:
    mode = mode.lower()
    if mode not in driver.POWER_MODES:
        return False
    ok = driver.ddcutil_setvcp(driver.VCP_POWER, driver.POWER_MODES[mode])
    if ok and mode == "on":
        # Give the monitor time to power on, then re-apply Standard mode.
        time.sleep(2)
        driver.init_monitor()
    return ok


def set_brightness(value: int, profile: str = "default") -> bool:
    """Manual brightness change — stored as today's `brightness_day` value."""
    if not 0 <= value <= 100:
        return False
    ok = driver.ddcutil_setvcp(driver.VCP_BRIGHTNESS, str(value))
    if ok:
        device_config.set_value("monitor", "brightness_day", value, profile=profile)
    return ok


def set_contrast(value: int, profile: str = "default") -> bool:
    if not 0 <= value <= 100:
        return False
    return driver.ddcutil_setvcp(driver.VCP_CONTRAST, str(value))


def set_rgb(rgb: Dict[str, int]) -> bool:
    ok = True
    if "r" in rgb:
        ok = driver.ddcutil_setvcp(driver.VCP_RED_GAIN, str(rgb["r"])) and ok
    if "g" in rgb:
        ok = driver.ddcutil_setvcp(driver.VCP_GREEN_GAIN, str(rgb["g"])) and ok
    if "b" in rgb:
        ok = driver.ddcutil_setvcp(driver.VCP_BLUE_GAIN, str(rgb["b"])) and ok
    return ok


def set_preset(preset: str) -> bool:
    preset = preset.lower()
    if preset not in driver.COLOR_PRESETS:
        return False
    return driver.ddcutil_setvcp(driver.VCP_COLOR_PRESET, driver.COLOR_PRESETS[preset])


def set_mode(mode: str) -> bool:
    mode = mode.lower()
    if mode not in driver.DISPLAY_MODES:
        return False
    return driver.ddcutil_setvcp(driver.VCP_DISPLAY_MODE, driver.DISPLAY_MODES[mode])


def set_e2(value: int) -> bool:
    if not 0 <= value <= 25:
        return False
    return driver.ddcutil_setvcp(driver.VCP_CUSTOM_E2, f"0x{value:02X}")


def apply_profile(profile: str) -> Dict[str, Any]:
    """Resolve `profile`'s monitor_config (defaults overlaid with their
    overrides) and push every HW-applicable value onto the monitor. Does not
    write to the DB — this applies an existing profile, it does not set one.
    """
    cfg = device_config.resolve("monitor", profile)
    for apply in _HW_APPLIERS:
        apply(cfg)
    return cfg
