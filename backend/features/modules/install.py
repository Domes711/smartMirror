"""Install / uninstall community modules onto the Pi.

Clone + npm install runs on a background thread; progress lives in
`module_install_jobs` (SQLite) instead of the in-memory dict the supervisor
used — so a restart mid-install no longer leaves the app polling a job that
has silently vanished.
"""

import logging
import os
import re
import shutil
import threading
import uuid

from data import module_install_jobs
from shared import db, systemctl
from shared import paths

from . import catalog

log = logging.getLogger("modules.install")

# A module directory/name we are willing to clone + place on disk. Not just
# `MMM-*`: the community store has modules like `DWD-RealtimeIrishRail` or
# `mmm-amazon-photos`. Still one plain path segment — no `/`, no leading dot.
MODULE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")

_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# job state
# --------------------------------------------------------------------------- #
def _set_job(job_id: str, **kw) -> None:
    module_install_jobs.update(job_id, **kw)


def _active_job(mtype: str):
    return module_install_jobs.running_for(mtype)


def status(mtype: str) -> dict:
    """Latest job for a module, in the shape the app's progress bar reads."""
    db.init()
    row = module_install_jobs.latest_for(mtype)
    if not row:
        return {"phase": "idle", "percent": 0, "done": False}
    done = row["status"] != "running"
    return {"phase": row["phase"], "percent": row["percent"], "done": done,
            "ok": row["status"] == "ok", "error": row["error"],
            "name": row["module_name"]}


# --------------------------------------------------------------------------- #
# install
# --------------------------------------------------------------------------- #
def _worker(job_id: str, mtype: str, url: str, dest: str) -> None:
    try:
        _set_job(job_id, phase="cloning", percent=10)
        rc, out = systemctl.git_clone(url, dest)
        if rc != 0:
            raise RuntimeError("git clone selhal: " + out[-400:])

        _set_job(job_id, phase="cloned", percent=40)
        if os.path.isfile(os.path.join(dest, "package.json")):
            _set_job(job_id, phase="npm", percent=50)
            rc, out = systemctl.npm_install(dest)
            if rc != 0:
                raise RuntimeError("npm install selhal: " + out[-400:])

        _set_job(job_id, phase="registering", percent=90)
        catalog.mark_installed(mtype, url)
        # The module now lives on disk and in the catalog. It is wired into
        # config.js and hot-loaded into the running core only when the user
        # places it in a scene — no config write, no pm2 restart here.
        _set_job(job_id, phase="done", percent=100, status="ok",
                 finished_at=_now())
        log.info("installed module %s", mtype)
    except Exception as exc:  # noqa: BLE001
        try:
            if os.path.isdir(dest):
                shutil.rmtree(dest)
        except Exception:  # noqa: BLE001
            pass
        _set_job(job_id, phase="error", percent=100, status="error",
                 error=str(exc), finished_at=_now())
        log.warning("install %s failed: %s", mtype, exc)


def _now() -> str:
    import datetime
    return datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def install(mtype: str) -> dict:
    """Validate against the stored catalog, then clone on a background thread."""
    db.init()
    row = catalog.lookup(mtype)
    if not row:
        raise ValueError("modul není v katalogu")
    name = row["module_name"] or mtype
    url = row["repo_url"] or ""
    if not MODULE_NAME_RE.match(name):
        raise ValueError(f"neplatné jméno modulu: {name}")
    # Only the two forges the catalog actually lists; anything else would be
    # cloning an arbitrary URL chosen by catalog data.
    if not (url.startswith("https://github.com/")
            or url.startswith("https://gitlab.com/")):
        raise ValueError("modul nemá repozitář na GitHubu/GitLabu — nejde "
                         "nainstalovat" if not url else
                         "nepodporovaný zdroj (jen github/gitlab https)")

    dest = os.path.join(paths.MM_MODULES_DIR, name)
    if os.path.exists(dest):
        raise RuntimeError("modul už je nainstalovaný")

    with _lock:
        if _active_job(mtype):
            raise RuntimeError("instalace už běží")
        job_id = uuid.uuid4().hex
        module_install_jobs.create(job_id, mtype, phase="starting")
        module_install_jobs.update(job_id, percent=2)

    threading.Thread(target=_worker, args=(job_id, mtype, url, dest),
                     daemon=True).start()
    return {"ok": True, "started": True, "name": name}


# --------------------------------------------------------------------------- #
# uninstall
# --------------------------------------------------------------------------- #
def uninstall(mtype: str) -> dict:
    """Remove the module dir, its catalog row, and every scene instance of it,
    then regenerate the config and restart the mirror."""
    if not MODULE_NAME_RE.match(mtype or ""):
        raise ValueError("neplatné jméno modulu")

    from features.scenes import codegen, store as scene_store

    dest = os.path.join(paths.MM_MODULES_DIR, mtype)
    if os.path.isdir(dest):
        shutil.rmtree(dest)

    # FK cascade removes the layout rows referencing these instances, so
    # there is no manual sweep of defaults/windows any more.
    removed = scene_store.remove_instances_of_type(mtype)
    catalog.remove(mtype)

    codegen.generate(scene_store.load(), catalog.by_type())
    res = systemctl.pm2_restart()
    return {"ok": res.get("ok", False), "removed": mtype,
            "instances_removed": sorted(removed),
            "output": res.get("output", "")}


# --------------------------------------------------------------------------- #
# README (shown in the store detail view)
# --------------------------------------------------------------------------- #
def _raw_readme_urls(repo_url: str):
    """(candidate raw README URLs, raw base for relative images)."""
    u = (repo_url or "").rstrip("/").removesuffix(".git")
    if "github.com" in u:
        base = u.replace("github.com", "raw.githubusercontent.com")
        return ([f"{base}/{ref}/README.md" for ref in ("HEAD", "master", "main")],
                f"{base}/HEAD/")
    if "gitlab.com" in u:
        return ([f"{u}/-/raw/{ref}/README.md" for ref in ("HEAD", "master", "main")],
                f"{u}/-/raw/HEAD/")
    return [], ""


def readme(mtype: str, url: str = "") -> dict:
    """README markdown. Local file for modules on disk, forge raw otherwise.
    `baseUrl` lets the app resolve relative image paths in the markdown."""
    safe = (mtype or "").split("/")[-1]
    if "/" not in (mtype or "") and MODULE_NAME_RE.match(safe):
        local = os.path.join(paths.MM_MODULES_DIR, safe)
        if os.path.isdir(local):
            for fn in ("README.md", "readme.md", "Readme.md"):
                p = os.path.join(local, fn)
                if os.path.isfile(p):
                    with open(p, encoding="utf-8", errors="replace") as f:
                        return {"markdown": f.read(), "baseUrl": ""}
            return {"markdown": "", "baseUrl": ""}

    import urllib.request
    if not url:
        row = catalog.lookup(mtype)
        url = row["repo_url"] if row else ""
    urls, base = _raw_readme_urls(url)
    for u in urls:
        try:
            req = urllib.request.Request(
                u, headers={"User-Agent": "smartmirror-backend"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return {"markdown": r.read().decode("utf-8", "replace"),
                        "baseUrl": base}
        except Exception:  # noqa: BLE001
            continue
    return {"markdown": "", "baseUrl": base}
