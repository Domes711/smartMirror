"""profiles — people the mirror knows (the one cross-cutting table)."""

from shared import db

_COLS = "name, is_default, created_at"


def _row(r) -> dict:
    return {"name": r["name"], "is_default": bool(r["is_default"]),
            "created_at": r["created_at"]}


def list_all() -> list[dict]:
    """Every profile, the default one first (the app always lists it first)."""
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM profiles ORDER BY is_default DESC, name ASC")]


def names() -> list[str]:
    return [r["name"] for r in db.query(
        "SELECT name FROM profiles ORDER BY is_default DESC, name ASC")]


def get(name: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM profiles WHERE name = ?", (name,))
    return _row(r) if r else None


def exists(name: str) -> bool:
    return db.one("SELECT 1 FROM profiles WHERE name = ?", (name,)) is not None


def ensure(name: str, conn=None) -> None:
    """Insert the row if missing. Both scenes and camera create profiles (a
    layout can be authored before any face is enrolled, and vice versa), so
    this is an upsert on both sides rather than one owner."""
    sql = "INSERT OR IGNORE INTO profiles(name) VALUES (?)"
    if conn is not None:
        conn.execute(sql, (name,))
    else:
        with db.tx() as c:
            c.execute(sql, (name,))


def delete(name: str, conn=None) -> None:
    """Remove a profile. ON DELETE CASCADE drops its instances, windows,
    layout entries, photos and hardware overrides.

    Refusing to delete the default profile is a rule, not data access — it
    lives in the feature (features/camera/profiles.py), which asks
    `is_default()` first.
    """
    sql = "DELETE FROM profiles WHERE name = ?"
    if conn is not None:
        conn.execute(sql, (name,))
    else:
        with db.tx() as c:
            c.execute(sql, (name,))


def is_default(name: str) -> bool:
    r = db.one("SELECT is_default FROM profiles WHERE name = ?", (name,))
    return bool(r and r["is_default"])


def default_name() -> str | None:
    """The profile shown when nobody is recognized. Exactly one row carries
    the flag (partial unique index `idx_one_default`), so this is unambiguous.

    There is no `set_default()`: the default profile is created by the
    migration and is not switched at runtime. Were that ever needed it would
    be an UPDATE of two rows in one transaction, since the index refuses two
    ones at a time.
    """
    r = db.one("SELECT name FROM profiles WHERE is_default = 1")
    return r["name"] if r else None
