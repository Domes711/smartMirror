"""<device>_config — hardware settings, with per-profile overrides.

Six tables (`radar_config`, `camera_config`, `monitor_config`,
`distance_config`, `mic_config`, `speaker_config`) share one shape:

    id | profile | key | value          value is JSON-encoded

`profile='default'` rows are the defaults, written by the migration. A row
naming a profile overrides that one key for that person; keys they did not
touch keep the default. Resolving is "read the defaults, overlay the profile".

This is the one deliberate exception to one-module-per-table: six identical
copies of this code would be pure duplication, so the table is a parameter.
"""

from shared import db

# The table name goes into SQL (it cannot be a `?` placeholder), so `device`
# is whitelisted here. Without this, a device name arriving from an MQTT or
# HTTP payload would be SQL injection.
DEVICES = ("radar", "camera", "monitor", "distance", "mic", "speaker")

DEFAULT_PROFILE = "default"


def _table(device: str) -> str:
    if device not in DEVICES:
        raise ValueError(f"unknown device: {device}")
    return f"{device}_config"


def defaults(device: str) -> dict:
    """Just the `profile='default'` rows."""
    t = _table(device)
    return {r["key"]: db.jload(r["value"]) for r in db.query(
        f"SELECT key, value FROM {t} WHERE profile = ?", (DEFAULT_PROFILE,))}


def overrides(device: str, profile: str) -> dict:
    """Just what this profile overrode — empty if they set nothing."""
    t = _table(device)
    if profile == DEFAULT_PROFILE:
        return {}
    return {r["key"]: db.jload(r["value"]) for r in db.query(
        f"SELECT key, value FROM {t} WHERE profile = ?", (profile,))}


def resolve(device: str, profile: str = DEFAULT_PROFILE) -> dict:
    """Defaults overlaid with the profile's overrides — what to hand the
    device. A profile with no rows at all gets the defaults untouched, so
    "the user set nothing extra" needs no special case."""
    cfg = defaults(device)
    cfg.update(overrides(device, profile))
    return cfg


def get(device: str, key: str, profile: str = DEFAULT_PROFILE,
        fallback=None):
    """One resolved key."""
    return resolve(device, profile).get(key, fallback)


def set_value(device: str, key: str, value, profile: str = DEFAULT_PROFILE,
              conn=None) -> None:
    t = _table(device)
    sql = (f"INSERT INTO {t}(profile, key, value) VALUES (?,?,?) "
           "ON CONFLICT(profile, key) DO UPDATE SET value = excluded.value")
    args = (profile, key, db.jdump(value))
    if conn is not None:
        conn.execute(sql, args)
    else:
        with db.tx() as c:
            c.execute(sql, args)


def set_many(device: str, values: dict, profile: str = DEFAULT_PROFILE) -> None:
    """Upsert several keys in one transaction."""
    t = _table(device)
    with db.tx() as conn:
        for key, value in (values or {}).items():
            conn.execute(
                f"INSERT INTO {t}(profile, key, value) VALUES (?,?,?) "
                "ON CONFLICT(profile, key) DO UPDATE SET value = excluded.value",
                (profile, key, db.jdump(value)))


def clear_override(device: str, key: str, profile: str) -> None:
    """Drop one override so the key falls back to the default. Refuses to
    touch the default rows — deleting those would leave the device with no
    value at all."""
    if profile == DEFAULT_PROFILE:
        raise ValueError("cannot clear a default value, only an override")
    t = _table(device)
    with db.tx() as conn:
        conn.execute(f"DELETE FROM {t} WHERE profile = ? AND key = ?",
                     (profile, key))


def clear_overrides(device: str, profile: str) -> None:
    if profile == DEFAULT_PROFILE:
        raise ValueError("cannot clear the default values")
    t = _table(device)
    with db.tx() as conn:
        conn.execute(f"DELETE FROM {t} WHERE profile = ?", (profile,))


def profiles_with_overrides(device: str) -> list[str]:
    t = _table(device)
    return [r["profile"] for r in db.query(
        f"SELECT DISTINCT profile FROM {t} WHERE profile != ? ORDER BY profile",
        (DEFAULT_PROFILE,))]
