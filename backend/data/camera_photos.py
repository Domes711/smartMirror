"""camera_photos — training photos for face recognition.

Only the inputs are rows; the trained model is a file
(var/encoded_faces.pickle) the face_recognition library loads whole.
"""

from shared import db


def files_for(profile: str) -> list[str]:
    return [r["file_path"] for r in db.query(
        "SELECT file_path FROM camera_photos WHERE profile_name = ? "
        "ORDER BY file_path", (profile,))]


def counts() -> dict[str, int]:
    """Photo count per profile, derived — never stored in a column."""
    return {r["profile_name"]: r["cnt"] for r in db.query(
        "SELECT profile_name, COUNT(*) AS cnt FROM camera_photos "
        "GROUP BY profile_name")}


def add(profile: str, file_path: str, conn=None) -> None:
    sql = ("INSERT OR IGNORE INTO camera_photos(profile_name, file_path) "
           "VALUES (?, ?)")
    if conn is not None:
        conn.execute(sql, (profile, file_path))
    else:
        with db.tx() as c:
            c.execute(sql, (profile, file_path))


def delete(profile: str, file_path: str, conn=None) -> None:
    sql = ("DELETE FROM camera_photos WHERE profile_name = ? "
           "AND file_path = ?")
    if conn is not None:
        conn.execute(sql, (profile, file_path))
    else:
        with db.tx() as c:
            c.execute(sql, (profile, file_path))


def delete_all_for(profile: str, conn=None) -> None:
    sql = "DELETE FROM camera_photos WHERE profile_name = ?"
    if conn is not None:
        conn.execute(sql, (profile,))
    else:
        with db.tx() as c:
            c.execute(sql, (profile,))


def profiles_with_photos() -> list[str]:
    return [r["profile_name"] for r in db.query(
        "SELECT DISTINCT profile_name FROM camera_photos")]
