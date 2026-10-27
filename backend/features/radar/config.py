"""Radar calibration, persisted in the central SQLite DB.

Stored as key-value rows (`radar_config`) rather than one blob, so a single
setting can be written without read-modify-write races between the daemon
(which saves learned ghost exclusions) and the app (which writes zone/offset
from the Dev screen).

The table is one of the six `<device>_config` tables, so it goes through
`data.device_config`: `profile='default'` rows are these defaults, and a row
naming a profile overrides one key for that person.
"""

import json
import logging

from data import device_config
from shared import db

log = logging.getLogger("radar.config")

# Defaults mirror the daemon's tuning constants; see daemon.py for what each
# one tames.
DEFAULTS = {
    "zone": {"x": 400, "y": 1500},
    "x_offset": 0,            # mm subtracted from x to center the origin
    "invert_x": False,        # flip left/right if mirrored
    "enter_frames": 3,        # in-zone frames required before declaring PRESENT
    "max_range_mm": 6000,     # drop implausibly far targets (likely ghosts)
    "min_speed": 0,
    "alpha": 0.3,             # EMA factor: higher = snappier, lower = smoother
    "deadband_mm": 60,        # ignore moves smaller than this
    "exclusions": [],         # [[x,y],…] learned ghost spots to drop
}

KEYS = tuple(DEFAULTS)


def load(profile: str = "default") -> dict:
    """Full config: the constants above, overlaid with what is stored.

    The in-code DEFAULTS stay the base layer so a key that was never written
    still has a value — the table is seeded empty for radar.
    """
    cfg = json.loads(json.dumps(DEFAULTS))
    try:
        db.init()
        for key, value in device_config.resolve("radar", profile).items():
            if key in DEFAULTS:
                cfg[key] = value
    except Exception as exc:  # noqa: BLE001
        log.warning("config load failed, using defaults: %s", exc)
    return cfg


def save(cfg: dict, profile: str = "default") -> None:
    """Upsert every known key present in `cfg`. Unknown keys are ignored."""
    try:
        device_config.set_many(
            "radar", {k: cfg[k] for k in KEYS if k in cfg}, profile=profile)
    except Exception as exc:  # noqa: BLE001
        log.warning("config save failed: %s", exc)


def set_key(key: str, value, profile: str = "default") -> None:
    if key not in DEFAULTS:
        raise ValueError(f"unknown radar config key: {key}")
    save({key: value}, profile=profile)
