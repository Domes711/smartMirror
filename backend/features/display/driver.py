"""Everything hardware-specific: Dell U2515H over DDC/CI (ddcutil).

The only place that shells out to `ddcutil`. No MQTT, no DB — just VCP
feature codes and the subprocess calls that read/write them.
"""

import logging
import re
import subprocess
from typing import Optional

from features.display.constants import (
    VCP_BRIGHTNESS, VCP_CONTRAST, VCP_COLOR_PRESET, VCP_RED_GAIN,
    VCP_GREEN_GAIN, VCP_BLUE_GAIN, VCP_POWER, VCP_DISPLAY_MODE,
    VCP_CUSTOM_E2, COLOR_PRESETS, DISPLAY_MODES, POWER_MODES,
)

log = logging.getLogger(__name__)


def init_monitor() -> None:
    """Set the monitor to Standard mode so manual brightness control works.

    Dell monitors with dynamic contrast enabled block manual brightness
    changes; Display Mode = Standard (VCP DC = 0x00) disables it.
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


def ddcutil_setvcp(feature: str, value: str, noverify: bool = True) -> bool:
    """Execute `ddcutil setvcp`. Returns whether it succeeded."""
    try:
        cmd = ["ddcutil", "setvcp", feature, value]
        if noverify:
            cmd.insert(1, "--noverify")

        log.info("Setting VCP %s = %s", feature, value)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

        if result.returncode != 0:
            log.error("ddcutil setvcp failed: %s", result.stderr)
            return False

        return True
    except subprocess.TimeoutExpired:
        log.error("ddcutil timeout for feature %s", feature)
        return False
    except FileNotFoundError:
        log.warning("ddcutil not found")
        return False
    except Exception as e:
        log.error("ddcutil error: %s", e)
        return False


def ddcutil_getvcp(feature: str) -> Optional[int]:
    """Execute `ddcutil getvcp` and return the current value, or None."""
    try:
        cmd = ["ddcutil", "getvcp", feature]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

        if result.returncode != 0:
            return None

        # Standard: "VCP code 0x10 (Brightness): current value = 100, max value = 100"
        # Power:    "VCP code 0xd6 (Power mode): DPM: On, DPMS: Off (sl=0x01)"
        for line in result.stdout.split("\n"):
            if "current value" in line:
                parts = line.split("current value")[1].split(",")[0]
                return int(parts.strip().replace("=", "").strip())
            elif "(sl=" in line:
                match = re.search(r"\(sl=(0x[0-9a-fA-F]+)\)", line)
                if match:
                    return int(match.group(1), 16)

        return None
    except FileNotFoundError:
        return None
    except Exception as e:
        log.error("getvcp error for %s: %s", feature, e)
        return None
