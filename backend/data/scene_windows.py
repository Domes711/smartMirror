"""scene_windows — named time windows during which a layout applies.

The active window is the one whose `from` fired most recently and more
recently than its `to`; latest `from` wins on ties. That resolution lives in
MagicMirror/js/profile.js — this module only stores the rows.
"""

from shared import db

_COLS = "id, profile, window_name, from_cron, to_cron, label"


def _row(r) -> dict:
    return {"id": r["id"], "profile": r["profile"],
            "window_name": r["window_name"], "from_cron": r["from_cron"],
            "to_cron": r["to_cron"], "label": r["label"]}


def list_all() -> list[dict]:
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM scene_windows ORDER BY profile, window_name")]


def any_exist() -> bool:
    return db.one("SELECT 1 FROM scene_windows LIMIT 1") is not None


def insert(profile: str, window_name: str, from_cron: str, to_cron: str,
           label: str = "", conn=None) -> int:
    """Returns the new window's id (layout entries reference it)."""
    sql = ("INSERT INTO scene_windows(profile, window_name, from_cron, "
           "to_cron, label) VALUES (?,?,?,?,?)")
    args = (profile, window_name, from_cron, to_cron, label or "")
    if conn is not None:
        return conn.execute(sql, args).lastrowid
    with db.tx() as c:
        return c.execute(sql, args).lastrowid


def delete_all(conn=None) -> None:
    """Wipe every window. The editor saves the whole document, so a full
    replace is simpler and race-free compared with diffing."""
    if conn is not None:
        conn.execute("DELETE FROM scene_windows")
    else:
        with db.tx() as c:
            c.execute("DELETE FROM scene_windows")
