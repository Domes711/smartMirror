"""ai_module_messages — the chat transcript of one ai_module_sessions row.

One row per message; CASCADE-deleted with its session. This replaces the old
on-disk .module-chat.json transcript.
"""

from shared import db

ROLES = ("user", "assistant", "sys")

_COLS = "id, session_id, role, text, created_at"


def _row(r) -> dict:
    return dict(r)


def list_for(session_id: int) -> list[dict]:
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM ai_module_messages "
        "WHERE session_id = ? ORDER BY id", (session_id,))]


def add(session_id: int, role: str, text: str, conn=None) -> int:
    if role not in ROLES:
        raise ValueError(f"unknown role: {role}")

    def _do(c):
        cur = c.execute(
            "INSERT INTO ai_module_messages(session_id, role, text) "
            "VALUES (?, ?, ?)", (session_id, role, text))
        return cur.lastrowid

    if conn is not None:
        return _do(conn)
    with db.tx() as c:
        return _do(c)
