"""module_catalog — what modules are available on this mirror.

Identity is `id` (what everything else FKs to) plus `module_name` (the folder
under MagicMirror/modules/, UNIQUE). There is no separate `type`: it used to
duplicate `module_name` on every row.
"""

from shared import db

SOURCES = ("custom", "installed", "community", "ai")

# Sources whose files already live on this Pi, so the scene editor may place
# them. `community` is browse-only until installed.
ON_DISK = ("custom", "installed", "ai")

_COLS = ("id, module_name, label_cs, label_en, description_cs, "
         "description_en, category, source, repo_url, maintainer, stars, "
         "installed_at, ai_module_session_id")


def _row(r) -> dict:
    return dict(r)


def list_all() -> list[dict]:
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM module_catalog ORDER BY module_name")]


def list_on_disk() -> list[dict]:
    """Rows the scene editor may place (custom + installed)."""
    marks = ",".join("?" * len(ON_DISK))
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM module_catalog WHERE source IN ({marks}) "
        "ORDER BY module_name", ON_DISK)]


def _browse_where(q: str, tag: str) -> tuple[str, list]:
    """Rows the store's browse list shows (everything but our own `custom`
    modules), optionally narrowed by free text and/or one tag."""
    where, args = ["source != 'custom'"], []
    if q:
        like = f"%{q}%"
        where.append(
            "(module_name LIKE ? OR label_cs LIKE ? OR label_en LIKE ? OR "
            "description_cs LIKE ? OR description_en LIKE ? OR EXISTS ("
            "SELECT 1 FROM module_tags t WHERE t.module_id = module_catalog.id "
            "AND t.tag LIKE ?))")
        args += [like] * 6
    if tag:
        where.append("EXISTS (SELECT 1 FROM module_tags t WHERE "
                     "t.module_id = module_catalog.id AND t.tag = ?)")
        args.append(tag)
    return " AND ".join(where), args


def browse_page(q: str = "", tag: str = "", offset: int = 0,
                limit: int = 30) -> list[dict]:
    """One page of the browse list, by name."""
    where, args = _browse_where(q, tag)
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM module_catalog WHERE {where} "
        "ORDER BY module_name COLLATE NOCASE LIMIT ? OFFSET ?",
        (*args, limit, offset))]


def browse_count(q: str = "", tag: str = "") -> int:
    where, args = _browse_where(q, tag)
    return db.one(f"SELECT COUNT(*) c FROM module_catalog WHERE {where}",
                  args)["c"]


def get(module_id: int) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM module_catalog WHERE id = ?", (module_id,))
    return _row(r) if r else None


def get_by_name(module_name: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM module_catalog WHERE module_name = ?",
               (module_name,))
    return _row(r) if r else None


def id_for(module_name: str) -> int | None:
    r = db.one("SELECT id FROM module_catalog WHERE module_name = ?",
               (module_name,))
    return r["id"] if r else None


def upsert(module_name: str, source: str, conn=None, **cols) -> int:
    """Insert or update one catalog row, returning its id.

    `installed_at` is never cleared by an update: re-seeding the community
    catalog must not forget that a module is installed here. Same for
    `ai_module_session_id`: once a module has been opened in the AI builder,
    later non-AI upserts (e.g. re-seeding) must not drop the link.
    """
    if source not in SOURCES:
        raise ValueError(f"unknown source: {source}")
    if not module_name:
        raise ValueError("catalog row without module_name")

    fields = ("label_cs", "label_en", "description_cs", "description_en",
              "category", "repo_url", "maintainer", "stars", "installed_at",
              "ai_module_session_id")
    vals = {f: cols.get(f) for f in fields}
    for f in ("label_cs", "label_en", "description_cs", "description_en",
              "category", "repo_url", "maintainer"):
        vals[f] = vals[f] or ""

    sql = f"""
        INSERT INTO module_catalog
          (module_name, source, {", ".join(fields)})
        VALUES (?, ?, {", ".join("?" * len(fields))})
        ON CONFLICT(module_name) DO UPDATE SET
          source=excluded.source,
          {", ".join(f"{f}=excluded.{f}" for f in fields
                     if f not in ("installed_at", "ai_module_session_id"))},
          installed_at=COALESCE(excluded.installed_at,
                                module_catalog.installed_at),
          ai_module_session_id=COALESCE(excluded.ai_module_session_id,
                                        module_catalog.ai_module_session_id)
    """
    args = (module_name, source, *(vals[f] for f in fields))

    def _do(c):
        c.execute(sql, args)
        return c.execute("SELECT id FROM module_catalog WHERE module_name = ?",
                         (module_name,)).fetchone()[0]

    if conn is not None:
        return _do(conn)
    with db.tx() as c:
        return _do(c)


def set_ai_session(module_name: str, session_id: int) -> None:
    """Link a catalog row to the AI builder session that built/last edited
    it. Separate from `upsert()` because the AI builder does not otherwise
    touch label/description/etc. when it is just claiming an existing
    community module for editing."""
    with db.tx() as conn:
        conn.execute(
            "UPDATE module_catalog SET ai_module_session_id = ? "
            "WHERE module_name = ?", (session_id, module_name))


def mark_installed(module_name: str, repo_url: str = "") -> int:
    """Flip a community row to `installed`, or create one for a module that
    was side-loaded and is not in the community catalog at all."""
    with db.tx() as conn:
        row = conn.execute("SELECT id FROM module_catalog WHERE module_name = ?",
                           (module_name,)).fetchone()
        if row:
            conn.execute(
                "UPDATE module_catalog SET source='installed', "
                "installed_at=datetime('now') WHERE id = ?", (row[0],))
            return row[0]
        cur = conn.execute(
            "INSERT INTO module_catalog(module_name, label_cs, source, "
            "repo_url, installed_at) VALUES (?,?, 'installed', ?, "
            "datetime('now'))", (module_name, module_name, repo_url))
        return cur.lastrowid


def delete(module_id: int) -> None:
    """Remove a catalog row. CASCADE takes its fields, images, screenshots,
    tags and every profile's instance of it."""
    with db.tx() as conn:
        conn.execute("DELETE FROM module_catalog WHERE id = ?", (module_id,))


def delete_by_name(module_name: str) -> None:
    with db.tx() as conn:
        conn.execute("DELETE FROM module_catalog WHERE module_name = ?",
                     (module_name,))


def count() -> int:
    return db.one("SELECT COUNT(*) c FROM module_catalog")["c"]
