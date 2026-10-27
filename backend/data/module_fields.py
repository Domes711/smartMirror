"""module_fields — the form fields to ask for when placing a module."""

from shared import db

_COLS = ("id, module_id, key, label_cs, label_en, required, field_type, "
         "placeholder, help, options_json, sort")


def _row(r) -> dict:
    return {"id": r["id"], "module_id": r["module_id"], "key": r["key"],
            "label_cs": r["label_cs"], "label_en": r["label_en"],
            "required": bool(r["required"]), "field_type": r["field_type"],
            "placeholder": r["placeholder"], "help": r["help"],
            "options": db.jload(r["options_json"]), "sort": r["sort"]}


def for_module(module_id: int) -> list[dict]:
    return [_row(r) for r in db.query(
        f"SELECT {_COLS} FROM module_fields WHERE module_id = ? "
        "ORDER BY sort, id", (module_id,))]


def replace(module_id: int, fields: list[dict], conn=None) -> None:
    """Replace the module's whole field set. Fields are defined by the seed /
    AI builder, so a partial update has no caller."""
    def _do(c):
        c.execute("DELETE FROM module_fields WHERE module_id = ?", (module_id,))
        for sort, f in enumerate(fields or []):
            if not f.get("key"):
                continue
            c.execute(
                "INSERT INTO module_fields(module_id, key, label_cs, label_en, "
                "required, field_type, placeholder, help, options_json, sort) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (module_id, f["key"],
                 f.get("label_cs") or f.get("label") or f["key"],
                 f.get("label_en") or "",
                 1 if f.get("required") else 0,
                 f.get("field_type") or f.get("type") or "text",
                 f.get("placeholder") or "", f.get("help") or "",
                 db.jdump(f["options"]) if f.get("options") else None,
                 sort))

    if conn is not None:
        _do(conn)
    else:
        with db.tx() as c:
            _do(c)
