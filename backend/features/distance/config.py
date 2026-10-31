"""Distance sensor calibration, persisted in the central SQLite DB.

Stored as key-value rows (`distance_config`), one of the six `<device>_config`
tables — same shape and the same resolve-defaults-then-overlay pattern as
`features/radar/config.py` and `features/mic/config.py`: `profile='default'`
rows are these defaults, and a row naming a profile overrides one key for
that person.
"""

import json
import logging

from data import device_config
from shared import db

log = logging.getLogger("distance.config")

DEFAULTS = {
    "warn_cm": 30,          # distances at or below this are "near"
    "max_range_cm": 400,    # HC-SR04 spec max; readings beyond this are dropped
    "avg_window_s": 1.0,    # collect pings for this long, publish their mean
    "absent_after_n": 3,    # consecutive above-threshold readings before ABSENT
}

KEYS = tuple(DEFAULTS)


def load(profile: str = "default") -> dict:
    """Full config: the constants above, overlaid with what is stored."""
    cfg = json.loads(json.dumps(DEFAULTS))
    try:
        db.init()
        for key, value in device_config.resolve("distance", profile).items():
            if key in DEFAULTS:
                cfg[key] = value
    except Exception as exc:  # noqa: BLE001
        log.warning("config load failed, using defaults: %s", exc)
    return cfg


def save(cfg: dict, profile: str = "default") -> None:
    """Upsert every known key present in `cfg`. Unknown keys are ignored."""
    device_config.set_many(
        "distance", {k: cfg[k] for k in KEYS if k in cfg}, profile=profile)


def set_key(key: str, value, profile: str = "default") -> None:
    if key not in DEFAULTS:
        raise ValueError(f"unknown distance config key: {key}")
    save({key: value}, profile=profile)
