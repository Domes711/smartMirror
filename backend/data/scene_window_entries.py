"""scene_window_entries — which instance sits where, inside one time window."""

from shared import db


def for_window(window_id: int) -> list[dict]:
    return [{"instance_id": r["instance_id"], "position": r["position"]}
            for r in db.query(
                "SELECT instance_id, position FROM scene_window_entries "
                "WHERE window_id = ? ORDER BY sort, id", (window_id,))]


def insert(window_id: int, instance_id: str, position: str, sort: int = 0,
           conn=None) -> None:
    sql = ("INSERT INTO scene_window_entries(window_id, instance_id, position, "
           "sort) VALUES (?,?,?,?)")
    args = (window_id, instance_id, position, sort)
    if conn is not None:
        conn.execute(sql, args)
    else:
        with db.tx() as c:
            c.execute(sql, args)


def delete_all(conn=None) -> None:
    if conn is not None:
        conn.execute("DELETE FROM scene_window_entries")
    else:
        with db.tx() as c:
            c.execute("DELETE FROM scene_window_entries")
