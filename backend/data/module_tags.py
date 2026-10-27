"""module_tags — tags for filtering the store."""

from shared import db


def for_module(module_id: int) -> list[str]:
    return [r["tag"] for r in db.query(
        "SELECT tag FROM module_tags WHERE module_id = ? ORDER BY tag",
        (module_id,))]


def replace(module_id: int, tags, conn=None) -> None:
    def _do(c):
        c.execute("DELETE FROM module_tags WHERE module_id = ?", (module_id,))
        for tag in tags or []:
            if tag:
                c.execute("INSERT OR IGNORE INTO module_tags(module_id, tag) "
                          "VALUES (?, ?)", (module_id, tag))

    if conn is not None:
        _do(conn)
    else:
        with db.tx() as c:
            _do(c)
