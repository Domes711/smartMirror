"""scene_instances — configured modules, one row per (module, profile).

`values_json` holds the raw form values. What MagicMirror receives is derived
from them by `codegen.module_config()` on every generate and never cached — a
fixed mapping must also apply to instances saved before the fix.
"""

from shared import db

_COLS = "id, module_id, profile, values_json, placement, created_at"


def _row(r) -> dict:
    return {"id": r["id"], "module_id": r["module_id"],
            "profile": r["profile"], "values": db.jload(r["values_json"], {}),
            "placement": r["placement"], "created_at": r["created_at"]}


def list_all() -> list[dict]:
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM scene_instances ORDER BY profile, id")]


def list_with_module_name() -> list[dict]:
    """Instances joined to the catalog, so callers get the module name
    without a second lookup. The name is what codegen and the app speak."""
    out = []
    for r in db.query(
        "SELECT i.id, i.module_id, i.profile, i.values_json, i.placement, "
        "       c.module_name "
        "FROM scene_instances i "
        "JOIN module_catalog c ON c.id = i.module_id "
        "ORDER BY i.profile, i.id"
    ):
        out.append({"id": r["id"], "module_id": r["module_id"],
                    "module": r["module_name"], "profile": r["profile"],
                    "values": db.jload(r["values_json"], {}),
                    "placement": r["placement"]})
    return out


def get(instance_id: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM scene_instances WHERE id = ?",
               (instance_id,))
    return _row(r) if r else None


def ids(conn=None) -> set[str]:
    """Every instance id. Pass `conn` to read inside an open transaction —
    a caller mid-save must see the rows it just inserted."""
    if conn is not None:
        return {r[0] for r in conn.execute("SELECT id FROM scene_instances")}
    return {r["id"] for r in db.query("SELECT id FROM scene_instances")}


def insert(instance_id: str, module_id: int, profile: str, values: dict,
           placement: str = "region", conn=None) -> None:
    sql = ("INSERT INTO scene_instances(id, module_id, profile, values_json, "
           "placement) VALUES (?,?,?,?,?)")
    args = (instance_id, module_id, profile, db.jdump(values or {}),
            placement or "region")
    if conn is not None:
        conn.execute(sql, args)
    else:
        with db.tx() as c:
            c.execute(sql, args)


def delete_for_profile(profile: str, conn=None) -> None:
    sql = "DELETE FROM scene_instances WHERE profile = ?"
    if conn is not None:
        conn.execute(sql, (profile,))
    else:
        with db.tx() as c:
            c.execute(sql, (profile,))


def delete_for_module(module_id: int) -> set[str]:
    """Drop every profile's instance of a module and return the removed ids.

    Deliberately profile-blind: uninstalling deletes the cloned repo, so the
    module stops working for everyone. The FK cascade removes the layout rows
    that referenced them.
    """
    with db.tx() as conn:
        rows = conn.execute("SELECT id FROM scene_instances WHERE module_id = ?",
                            (module_id,)).fetchall()
        removed = {r[0] for r in rows}
        conn.execute("DELETE FROM scene_instances WHERE module_id = ?",
                     (module_id,))
    return removed
