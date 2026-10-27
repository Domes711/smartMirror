"""module_screenshots — local preview files under var/module-assets/.

The binary stays a file; the row only holds the path. A blob in SQLite would
bloat the DB and complicate serving the image over HTTP for no gain.
"""

from shared import db


def _row(r) -> dict:
    return {"id": r["id"], "module_id": r["module_id"],
            "asset_path": r["asset_path"], "caption": r["caption"],
            "sort": r["sort"]}


def for_module(module_id: int) -> list[dict]:
    return [_row(r) for r in db.query(
        "SELECT id, module_id, asset_path, caption, sort FROM "
        "module_screenshots WHERE module_id = ? ORDER BY sort, id",
        (module_id,))]


def paths_for(module_id: int) -> list[str]:
    return [r["asset_path"] for r in db.query(
        "SELECT asset_path FROM module_screenshots WHERE module_id = ? "
        "ORDER BY sort, id", (module_id,))]


def replace(module_id: int, screenshots, conn=None) -> None:
    """Replace the module's screenshot list. Each item is a path string or a
    dict with `asset_path` / `caption`."""
    def _do(c):
        c.execute("DELETE FROM module_screenshots WHERE module_id = ?",
                  (module_id,))
        for sort, s in enumerate(screenshots or []):
            path = s if isinstance(s, str) else (s.get("asset_path") or "")
            caption = "" if isinstance(s, str) else (s.get("caption") or "")
            if path:
                c.execute("INSERT INTO module_screenshots(module_id, "
                          "asset_path, caption, sort) VALUES (?,?,?,?)",
                          (module_id, path, caption, sort))

    if conn is not None:
        _do(conn)
    else:
        with db.tx() as c:
            _do(c)
