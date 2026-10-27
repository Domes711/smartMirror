"""scene_default_entries — a profile's fallback layout.

Shown when none of that profile's windows is active ("Výchozí" in the app).
Unrelated to `profiles.is_default`, which says which profile covers an
unrecognized face.
"""

from shared import db


def all_by_profile() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in db.query(
        "SELECT profile, instance_id, position FROM scene_default_entries "
        "ORDER BY profile, sort, id"
    ):
        out.setdefault(r["profile"], []).append(
            {"instance_id": r["instance_id"], "position": r["position"]})
    return out


def for_profile(profile: str) -> list[dict]:
    return [{"instance_id": r["instance_id"], "position": r["position"]}
            for r in db.query(
                "SELECT instance_id, position FROM scene_default_entries "
                "WHERE profile = ? ORDER BY sort, id", (profile,))]


def insert(profile: str, instance_id: str, position: str, sort: int = 0,
           conn=None) -> None:
    sql = ("INSERT INTO scene_default_entries(profile, instance_id, position, "
           "sort) VALUES (?,?,?,?)")
    args = (profile, instance_id, position, sort)
    if conn is not None:
        conn.execute(sql, args)
    else:
        with db.tx() as c:
            c.execute(sql, args)


def delete_all(conn=None) -> None:
    if conn is not None:
        conn.execute("DELETE FROM scene_default_entries")
    else:
        with db.tx() as c:
            c.execute("DELETE FROM scene_default_entries")
