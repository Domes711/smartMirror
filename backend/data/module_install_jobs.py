"""module_install_jobs — progress of a background clone + npm install.

Keyed by `module_name` and deliberately without an FK: the job must outlive
the catalog row so a failed install can still be reported.
"""

from shared import db

_COLS = ("id, module_name, status, phase, percent, started_at, finished_at, "
         "error")


def _row(r) -> dict:
    return dict(r)


def create(job_id: str, module_name: str, phase: str = "",
           status: str = "running") -> None:
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO module_install_jobs(id, module_name, status, phase) "
            "VALUES (?,?,?,?)", (job_id, module_name, status, phase))


def update(job_id: str, **cols) -> None:
    """Patch the named columns. Whitelisted, since the names go into SQL."""
    allowed = {"status", "phase", "percent", "finished_at", "error"}
    bad = set(cols) - allowed
    if bad:
        raise ValueError(f"unknown job columns: {sorted(bad)}")
    if not cols:
        return
    sets = ", ".join(f"{k} = ?" for k in cols)
    with db.tx() as conn:
        conn.execute(f"UPDATE module_install_jobs SET {sets} WHERE id = ?",
                     (*cols.values(), job_id))


def get(job_id: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM module_install_jobs WHERE id = ?",
               (job_id,))
    return _row(r) if r else None


def latest_for(module_name: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM module_install_jobs WHERE module_name = ? "
               "ORDER BY started_at DESC, rowid DESC LIMIT 1", (module_name,))
    return _row(r) if r else None


def running_for(module_name: str) -> dict | None:
    r = db.one(f"SELECT {_COLS} FROM module_install_jobs WHERE module_name = ? "
               "AND status = 'running' ORDER BY started_at DESC LIMIT 1",
               (module_name,))
    return _row(r) if r else None
