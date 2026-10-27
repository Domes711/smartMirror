"""module_images — remote preview URLs from the upstream catalog.

Distinct from `module_screenshots`: those are local files served off disk,
these are URLs rendered straight from the internet. One module may have
several, which is why this is a table and not a column.
"""

from shared import db


def _row(r) -> dict:
    return {"id": r["id"], "module_id": r["module_id"], "url": r["url"],
            "caption": r["caption"], "sort": r["sort"]}


def for_module(module_id: int) -> list[dict]:
    return [_row(r) for r in db.query(
        "SELECT id, module_id, url, caption, sort FROM module_images "
        "WHERE module_id = ? ORDER BY sort, id", (module_id,))]


def urls_for(module_id: int) -> list[str]:
    return [r["url"] for r in db.query(
        "SELECT url FROM module_images WHERE module_id = ? ORDER BY sort, id",
        (module_id,))]


def replace(module_id: int, images, conn=None) -> None:
    """Replace the module's image list. Each item is a URL string or a dict
    with `url` / `caption`."""
    def _do(c):
        c.execute("DELETE FROM module_images WHERE module_id = ?", (module_id,))
        for sort, img in enumerate(images or []):
            url = img if isinstance(img, str) else (img.get("url") or "")
            caption = "" if isinstance(img, str) else (img.get("caption") or "")
            if url:
                c.execute("INSERT INTO module_images(module_id, url, caption, "
                          "sort) VALUES (?,?,?,?)",
                          (module_id, url, caption, sort))

    if conn is not None:
        _do(conn)
    else:
        with db.tx() as c:
            _do(c)
