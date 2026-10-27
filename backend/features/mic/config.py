"""Microphone configuration, persisted in the central SQLite DB.

Stored as key-value rows (`mic_config`), one of the six `<device>_config`
tables — same shape and the same resolve-defaults-then-overlay pattern as
`features/radar/config.py`: `profile='default'` rows are these defaults, and
a row naming a profile overrides one key for that person.

`device` is the ALSA capture device (e.g. `plughw:1,0`) used both by the test
recording (`arecord`) and by the Wyoming satellite's own `--mic-command`.
"""

import json
import logging

from data import device_config
from shared import db

log = logging.getLogger("mic.config")

DEFAULTS = {
    "device": "default",       # ALSA device name; see `arecord -L` on the Pi
    "satellite_name": "Smart Mirror",
    "wake_word": "ok_nabu",     # must match a model wyoming-openwakeword loads
    "input_gain": 80,           # 0-100, applied via `amixer` (ALSA_MIC_CONTROL)
}

KEYS = tuple(DEFAULTS)


def load(profile: str = "default") -> dict:
    """Full config: the constants above, overlaid with what is stored."""
    cfg = json.loads(json.dumps(DEFAULTS))
    try:
        db.init()
        for key, value in device_config.resolve("mic", profile).items():
            if key in DEFAULTS:
                cfg[key] = value
    except Exception as exc:  # noqa: BLE001
        log.warning("config load failed, using defaults: %s", exc)
    return cfg


def save(cfg: dict, profile: str = "default") -> None:
    """Upsert every known key present in `cfg`. Unknown keys are ignored."""
    device_config.set_many(
        "mic", {k: cfg[k] for k in KEYS if k in cfg}, profile=profile)


def set_key(key: str, value, profile: str = "default") -> None:
    if key not in DEFAULTS:
        raise ValueError(f"unknown mic config key: {key}")
    save({key: value}, profile=profile)
