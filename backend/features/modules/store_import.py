#!/usr/bin/env python3
"""Import the module store (github.com/Domes711/MMM-store) into the catalog.

The store repo holds one folder per community module:

    modules/<module_name>/mm-store.json   name/description (cs+en), scope,
                                          tags, screenshots, wizard (config
                                          fields the module needs)
    modules/<module_name>/screenshots/*.png

This script clones (or pulls) that repo, then writes every module into
`module_catalog` (source `community`) + `module_fields` (from `wizard`) +
`module_tags` + `module_screenshots` (PNGs copied to var/module-assets/) +
`module_images`. The store has no repo URL / maintainer / stars, so those
come from the upstream MagicMirror catalog (modules.json) — skip that with
`--no-upstream`; without a repo URL a module cannot be installed.

Rows already on this Pi keep their source: an `installed` module gets fresh
metadata but stays installed; `custom` and `ai` rows are never touched (their
fields drive scenes/codegen.py's config mapping). `community` rows that are no
longer in the store are removed unless `--keep-stale`.

Run by hand (or from setup.sh), never by the daemon:

    cd ~/smartMirror/backend
    python3 -m features.modules.store_import            # clone/pull + import
    python3 -m features.modules.store_import --src ~/MMM-store --no-upstream
"""

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from shared import db, paths  # noqa: E402
from data import module_catalog as catalog_data  # noqa: E402
from features.modules import catalog  # noqa: E402

log = logging.getLogger("modules.store_import")

STORE_REPO = os.environ.get("MMM_STORE_REPO") or \
    "https://github.com/Domes711/MMM-store.git"
STORE_BRANCH = os.environ.get("MMM_STORE_BRANCH") or "main"
UPSTREAM_CATALOG = "https://modules.magicmirror.builders/data/modules.json"
UPSTREAM_IMAGES = "https://modules.magicmirror.builders/images/"


# --------------------------------------------------------------------------- #
# store repo
# --------------------------------------------------------------------------- #
def default_checkout() -> str:
    return os.path.join(paths.VAR_DIR, "mmm-store")


def sync_repo(dest: str, repo: str = STORE_REPO,
              branch: str = STORE_BRANCH) -> None:
    """Shallow-clone the store, or fast-forward an existing checkout."""
    if os.path.isdir(os.path.join(dest, ".git")):
        # follow a changed remote (e.g. https → ssh) instead of the old one
        subprocess.run(["git", "-C", dest, "remote", "set-url", "origin",
                        repo], check=True)
        subprocess.run(["git", "-C", dest, "fetch", "--depth", "1", "origin",
                        branch], check=True)
        subprocess.run(["git", "-C", dest, "reset", "--hard",
                        f"origin/{branch}"], check=True)
    else:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", "--branch", branch,
                        repo, dest], check=True)


def fetch_upstream(url: str = UPSTREAM_CATALOG) -> dict:
    """module_name -> upstream entry. Several forks can share a name; the
    non-archived one with the most stars wins."""
    req = urllib.request.Request(url, headers={"User-Agent": "smartmirror"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    best: dict = {}
    for m in data.get("modules", data) if isinstance(data, dict) else data:
        name = m.get("name")
        if not name:
            continue
        rank = (not m.get("isArchived"), m.get("stars") or 0)
        cur = best.get(name)
        if cur is None or rank > (not cur.get("isArchived"),
                                  cur.get("stars") or 0):
            best[name] = m
    return best


# --------------------------------------------------------------------------- #
# mm-store.json -> catalog entry
# --------------------------------------------------------------------------- #
def _text(v, lang: str) -> str:
    """A {cs, en} dict or a plain string -> one string, other language as
    fallback."""
    if isinstance(v, dict):
        other = "en" if lang == "cs" else "cs"
        return str(v.get(lang) or v.get(other) or "")
    return "" if v is None else str(v)


def _options(raw) -> list:
    """Wizard options come as plain strings or {value, label}; the app wants
    [{value, label}] with string labels."""
    out = []
    for o in raw or []:
        if isinstance(o, dict):
            value = o.get("value")
            label = _text(o.get("label"), "cs") or str(value)
        else:
            value, label = o, str(o)
        if value is None:
            continue
        out.append({"value": value if isinstance(value, str)
                    else json.dumps(value), "label": label})
    return out


def wizard_fields(wizard) -> list:
    fields = []
    for w in wizard or []:
        if not isinstance(w, dict) or not w.get("key"):
            continue
        f = {"key": w["key"],
             "label_cs": _text(w.get("label"), "cs") or w["key"],
             "label_en": _text(w.get("label"), "en"),
             "required": bool(w.get("required")),
             "field_type": w.get("type") or "text",
             "help": _text(w.get("help"), "cs")}
        if w.get("placeholder"):
            f["placeholder"] = _text(w["placeholder"], "cs")
        elif w.get("default") not in (None, ""):
            f["placeholder"] = _text(w["default"], "cs") \
                if not isinstance(w["default"], (list, dict)) \
                else json.dumps(w["default"])
        if w.get("options"):
            f["options"] = _options(w["options"])
        fields.append(f)
    return fields


def entry_from_store(name: str, meta: dict, upstream: dict = None) -> dict:
    """mm-store.json (+ the upstream row, if any) in catalog.upsert()'s
    entry shape."""
    up = upstream or {}
    entry = {
        "module": name,
        "label_cs": _text(meta.get("name"), "cs") or name,
        "label_en": _text(meta.get("name"), "en"),
        "description_cs": _text(meta.get("description"), "cs"),
        "description_en": _text(meta.get("description"), "en"),
        "category": up.get("category") or "",
        "repo_url": up.get("url") or "",
        "maintainer": up.get("maintainer") or "",
        "stars": up.get("stars"),
        "tags": [t for t in meta.get("tags") or [] if isinstance(t, str)],
        "fields": wizard_fields(meta.get("wizard")),
    }
    if up.get("image"):
        entry["images"] = [UPSTREAM_IMAGES + up["image"]]
    return entry


def copy_screenshots(name: str, module_dir: str, rel_paths) -> list:
    """Copy the store's PNGs to var/module-assets/<name>/ and return the
    asset paths module_screenshots stores (relative to MODULE_ASSETS_DIR)."""
    out = []
    for rel in rel_paths or []:
        src = os.path.normpath(os.path.join(module_dir, rel))
        # stay inside the module folder whatever the JSON says
        if not src.startswith(module_dir + os.sep) or not os.path.isfile(src):
            continue
        dest_dir = os.path.join(paths.MODULE_ASSETS_DIR, name)
        os.makedirs(dest_dir, exist_ok=True)
        fname = os.path.basename(src)
        shutil.copyfile(src, os.path.join(dest_dir, fname))
        out.append(f"{name}/{fname}")
    return out


# --------------------------------------------------------------------------- #
# import
# --------------------------------------------------------------------------- #
def import_store(store_dir: str, upstream: dict = None,
                 prune: bool = True) -> dict:
    """Write every module under <store_dir>/modules into the catalog in one
    transaction. Returns counts."""
    db.init()
    upstream = upstream or {}
    modules_dir = os.path.realpath(os.path.join(store_dir, "modules"))
    rows = {r["module_name"]: r for r in catalog_data.list_all()}
    existing = {name: r["source"] for name, r in rows.items()}
    stats = {"imported": 0, "skipped_own": 0, "invalid": 0,
             "no_repo_url": 0, "pruned": 0}
    seen = set()

    with db.tx() as conn:
        for name in sorted(os.listdir(modules_dir)):
            module_dir = os.path.join(modules_dir, name)
            meta_path = os.path.join(module_dir, "mm-store.json")
            if not os.path.isfile(meta_path):
                continue
            seen.add(name)
            if existing.get(name) in ("custom", "ai"):
                stats["skipped_own"] += 1
                continue
            try:
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
                # no upstream row this run (offline / --no-upstream) → keep
                # what an earlier import stored instead of blanking it
                up = upstream.get(name)
                if up is None and name in rows:
                    r = rows[name]
                    up = {"url": r["repo_url"], "maintainer": r["maintainer"],
                          "stars": r["stars"], "category": r["category"]}
                entry = entry_from_store(name, meta, up)
            except (ValueError, OSError, AttributeError) as e:
                log.warning("skipping %s: %s", name, e)
                stats["invalid"] += 1
                continue
            entry["screenshots"] = copy_screenshots(
                name, module_dir, meta.get("screenshots"))
            if not entry["repo_url"]:
                stats["no_repo_url"] += 1
            source = "installed" if existing.get(name) == "installed" \
                else "community"
            catalog.upsert(entry, source, conn=conn)
            stats["imported"] += 1

        if prune:
            for name, source in existing.items():
                if source == "community" and name not in seen:
                    conn.execute("DELETE FROM module_catalog WHERE "
                                 "module_name = ?", (name,))
                    stats["pruned"] += 1
    return stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", help="use this local MMM-store checkout as-is "
                    "(no git clone/pull)")
    ap.add_argument("--repo", default=STORE_REPO)
    ap.add_argument("--branch", default=STORE_BRANCH)
    ap.add_argument("--no-upstream", action="store_true",
                    help="don't fetch repo URLs/stars from "
                    "modules.magicmirror.builders")
    ap.add_argument("--keep-stale", action="store_true",
                    help="keep community rows that are no longer in the store")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO,
                        format="[%(levelname)s] [store_import] %(message)s")

    paths.ensure_var_dirs()
    src = args.src
    if not src:
        src = default_checkout()
        log.info("Syncing %s (%s) into %s", args.repo, args.branch, src)
        sync_repo(src, args.repo, args.branch)

    upstream = {}
    if not args.no_upstream:
        try:
            upstream = fetch_upstream()
            log.info("Upstream catalog: %d modules", len(upstream))
        except Exception as e:  # noqa: BLE001
            log.warning("Upstream catalog unavailable (%s) — importing "
                        "without repo URLs", e)

    stats = import_store(src, upstream, prune=not args.keep_stale)
    log.info("Done: %s", ", ".join(f"{k}={v}" for k, v in stats.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
