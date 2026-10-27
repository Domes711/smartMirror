"""ai_module_sessions — one row per module name the AI module builder has
ever opened. One Claude conversation for the module's whole lifetime: draft
and installed share the same row and the same claude_session_id.

`scope` is the state of the *working copy* right now, not a key: 'draft'
means an in-progress copy sits in features/ai_modules/modules/<name>/
awaiting install; 'installed' means no pending copy exists. Editing an
already-installed module (AI-built or community) flips the row back to
'draft' while a new working copy is edited, keeping the same
claude_session_id so the agent remembers everything from before.
"""

from shared import db

SCOPES = ("draft", "installed")

_COLS = "id, scope, name, description, claude_session_id, created_at"


def _row(r) -> dict:
    return dict(r)


def get(session_id: int) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM ai_module_sessions WHERE id = ?",
               (session_id,))
    return _row(r) if r else None


def get_by_name(name: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM ai_module_sessions WHERE name = ?",
               (name,))
    return _row(r) if r else None


def list_by_scope(scope: str) -> list[dict]:
    if scope not in SCOPES:
        raise ValueError(f"unknown scope: {scope}")
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM ai_module_sessions WHERE scope = ? "
        "ORDER BY name", (scope,))]


def create(scope: str, name: str, description: str = "", conn=None) -> int:
    if scope not in SCOPES:
        raise ValueError(f"unknown scope: {scope}")

    def _do(c):
        cur = c.execute(
            "INSERT INTO ai_module_sessions(scope, name, description) "
            "VALUES (?, ?, ?)", (scope, name, description))
        return cur.lastrowid

    if conn is not None:
        return _do(conn)
    with db.tx() as c:
        return _do(c)


def set_scope(session_id: int, scope: str, conn=None) -> None:
    """Flip a session between 'draft' (a pending working copy exists) and
    'installed' (the working copy was applied and removed)."""
    if scope not in SCOPES:
        raise ValueError(f"unknown scope: {scope}")

    def _do(c):
        c.execute("UPDATE ai_module_sessions SET scope = ? WHERE id = ?",
                 (scope, session_id))

    if conn is not None:
        _do(conn)
    else:
        with db.tx() as c:
            _do(c)


def set_description(session_id: int, description: str) -> None:
    with db.tx() as conn:
        conn.execute(
            "UPDATE ai_module_sessions SET description = ? WHERE id = ?",
            (description, session_id))


def set_claude_session_id(session_id: int, claude_session_id: str) -> None:
    """Persist the CLI's own conversation id so `--resume` works again after
    a restart, and keeps working across a draft <-> installed scope flip."""
    with db.tx() as conn:
        conn.execute(
            "UPDATE ai_module_sessions SET claude_session_id = ? WHERE id = ?",
            (claude_session_id, session_id))


def delete(session_id: int) -> None:
    """Remove a session. CASCADE takes its messages; module_catalog rows
    keep their ai_module_session_id as NULL instead of a dangling id."""
    with db.tx() as conn:
        conn.execute("DELETE FROM ai_module_sessions WHERE id = ?",
                     (session_id,))
