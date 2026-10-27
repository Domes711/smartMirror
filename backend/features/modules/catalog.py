"""Module catalog: what can be placed on the mirror, and where it came from.

Stored in `module_catalog` + `module_fields` / `module_images` /
`module_screenshots` / `module_tags`, all reached through `data/`.

`source` records provenance:
    custom     files already in this repo — ours or AI-built. Installing
               clones nothing, because the module is on disk already.
    installed  cloned from upstream onto this Pi
    community  browse-only until installed; the only source that clones

The API still speaks module **names** (`type` on the wire, `clock`,
`MMM-Mail`), which is what codegen, the app and the install flow use. Catalog
ids stay inside the DB.

Screenshots stay as files on disk (`var/module-assets/<name>/*.png`); the row
only holds the path. A binary blob in SQLite would bloat the DB file and
complicate serving the image over HTTP for no gain.
"""

import logging
import os

from data import (module_catalog as catalog_data, module_fields,
                  module_images, module_screenshots, module_tags)
from shared import db
from shared import paths

log = logging.getLogger("modules.catalog")

SOURCES = catalog_data.SOURCES          # custom | installed | community

# The modules shipped in this repo, with the config fields the scene editor
# must prompt for before the module can be placed.
BUILTIN = [
    {"type": "clock", "module": "clock", "label": "Hodiny", "fields": []},
    # `alert` is placed as an `overlay` instance: it owns its own DOM, so the
    # profile system must neither move nor hide it. It needs a catalog row
    # like any other module now that instances carry a real FK — the core's
    # MIRROR_MESSAGE handler forwards app notes to it.
    {"type": "alert", "module": "alert", "label": "Upozornění", "fields": []},
    {"type": "compliments", "module": "compliments", "label": "Komplimenty",
     "fields": []},
    {"type": "MMM-GoogleCalendar", "module": "MMM-GoogleCalendar",
     "label": "Google kalendář", "fields": [
        {"key": "calendarID", "label": "Calendar ID", "required": True,
         "placeholder": "…@group.calendar.google.com"}]},
    {"type": "newsfeed", "module": "newsfeed", "label": "Zprávy (RSS)",
     "fields": [
        {"key": "url", "label": "RSS URL", "required": True,
         "placeholder": "https://…/rss"},
        {"key": "title", "label": "Název", "required": False,
         "placeholder": "Zprávy"}]},
    {"type": "MMM-Mail", "module": "MMM-Mail", "label": "E-mail", "fields": [
        {"key": "host", "label": "IMAP host", "required": True},
        {"key": "user", "label": "Uživatel", "required": True},
        {"key": "password", "label": "Heslo", "required": True}]},
    {"type": "MMM-Spending", "module": "MMM-Spending", "label": "Útraty",
     "fields": [
        {"key": "token", "label": "Wallet API token", "required": True}]},
    {"type": "MMM-HA-Reminders", "module": "MMM-HA-Reminders",
     "label": "Připomínky (HA)", "fields": [
        {"key": "haUrl", "label": "HA URL", "required": True},
        {"key": "token", "label": "HA token", "required": True},
        {"key": "entity", "label": "todo entity", "required": True}]},
    {"type": "MMM-Brno-Transit", "module": "MMM-Brno-Transit",
     "label": "MHD Brno", "fields": [
        {"key": "stopName", "label": "Zastávka", "required": True,
         "type": "brno_stop", "placeholder": "např. Hlavní nádraží"}]},
    {"type": "MMM-Package-Tracker", "module": "MMM-Package-Tracker",
     "label": "Zásilky", "fields": [
        {"key": "apiKey", "label": "AfterShip API key", "required": True},
        {"key": "entity", "label": "HA todo (balíčky)", "required": True}]},
    {"type": "weather", "module": "weather", "label": "Počasí", "fields": [
        {"key": "apiKey", "label": "OWM API key", "required": True},
        {"key": "lat", "label": "Lat", "required": True},
        {"key": "lon", "label": "Lon", "required": True}]},
]


# --------------------------------------------------------------------------- #
# write
# --------------------------------------------------------------------------- #
def upsert(entry: dict, source: str, conn=None) -> int:
    """Insert or update one catalog row plus its fields / tags / images /
    screenshots. Returns the catalog id.

    `entry` uses the API shape (`type`, `module`, `label`, `fields`, …) so
    callers do not have to know the column layout. `type` and `module` are
    both the module name; `module` wins when they differ.
    """
    name = entry.get("module") or entry.get("type")
    if not name:
        raise ValueError("catalog entry without a module name")

    def _do(c):
        module_id = catalog_data.upsert(
            name, source, conn=c,
            label_cs=entry.get("label_cs") or entry.get("label") or name,
            label_en=entry.get("label_en"),
            description_cs=(entry.get("description_cs")
                            or entry.get("description")),
            description_en=entry.get("description_en"),
            category=entry.get("category") or entry.get("scope"),
            repo_url=entry.get("repo_url") or entry.get("url"),
            maintainer=entry.get("maintainer"),
            stars=entry.get("stars"),
            installed_at=entry.get("installed_at"))

        if entry.get("fields") is not None:
            module_fields.replace(module_id, entry["fields"], conn=c)
        if entry.get("tags") is not None:
            module_tags.replace(module_id, entry["tags"], conn=c)
        if entry.get("screenshots") is not None:
            module_screenshots.replace(module_id, entry["screenshots"], conn=c)
        # `remote_image` used to be a single column; an upstream entry can
        # carry several previews, so they are rows now.
        imgs = entry.get("images")
        if imgs is None:
            one = entry.get("remote_image") or entry.get("image")
            imgs = [one] if one else None
        if imgs is not None:
            module_images.replace(module_id, imgs, conn=c)
        return module_id

    if conn is not None:
        return _do(conn)
    with db.tx() as c:
        return _do(c)


def mark_installed(name: str, repo_url: str = "") -> int:
    """Flip a community row to `installed` (or create one for a side-loaded
    module that is not in the community catalog at all)."""
    return catalog_data.mark_installed(name, repo_url)


def remove(name: str) -> None:
    catalog_data.delete_by_name(name)


def seed_builtins() -> None:
    """Idempotently (re)write the in-repo module rows. Safe on every boot —
    editing BUILTIN above is how these change, so the DB follows the code.

    These are `custom`: the files ship in this repo, so they are installed by
    definition and nothing is ever cloned for them.
    """
    db.init()
    with db.tx() as conn:
        for entry in BUILTIN:
            upsert(entry, "custom", conn=conn)


# --------------------------------------------------------------------------- #
# read
# --------------------------------------------------------------------------- #
def _fields_for(module_id: int) -> list:
    out = []
    for r in module_fields.for_module(module_id):
        f = {"key": r["key"],
             "label": r["label_cs"] or r["label_en"] or r["key"],
             "required": r["required"], "type": r["field_type"]}
        if r["placeholder"]:
            f["placeholder"] = r["placeholder"]
        if r["help"]:
            f["help"] = r["help"]
        if r["options"]:
            f["options"] = r["options"]
        out.append(f)
    return out


def _screenshots_for(module_id: int) -> list:
    """Asset URLs, served by the modules feature at /module-assets/."""
    import urllib.parse
    return [f"/module-assets/{urllib.parse.quote(p)}"
            for p in module_screenshots.paths_for(module_id)]


def placeable() -> list:
    """Catalog entries the scene editor may place: everything on this Pi
    (custom / installed) — community rows are browse-only until installed."""
    db.init()
    return [{"type": r["module_name"], "module": r["module_name"],
             "label": r["label_cs"] or r["label_en"] or r["module_name"],
             "fields": _fields_for(r["id"])}
            for r in catalog_data.list_on_disk()]


def by_type() -> dict:
    return {c["type"]: c for c in placeable()}


def installed_dirs() -> set:
    try:
        return {d for d in os.listdir(paths.MM_MODULES_DIR)
                if os.path.isdir(os.path.join(paths.MM_MODULES_DIR, d))}
    except Exception:  # noqa: BLE001
        return set()


def full_catalog() -> dict:
    """Everything, split the way the app's store screen expects.

    `community` is the browsable catalog (each flagged `installed`), `own` the
    modules living on this Pi that are not community entries.
    """
    db.init()
    dirs = installed_dirs()
    community, own = [], []
    for r in catalog_data.list_all():
        module_id, name = r["id"], r["module_name"]
        shots = _screenshots_for(module_id)
        remote = module_images.urls_for(module_id)
        entry = {
            "id": name, "name": name,
            "url": r["repo_url"],
            "description": r["description_cs"] or r["description_en"] or "",
            "category": r["category"], "maintainer": r["maintainer"],
            "stars": r["stars"],
            # A locally generated screenshot always beats the upstream image —
            # it shows the module as it actually renders on this mirror.
            "image": shots[0] if shots else (remote[0] if remote else None),
            "images": shots or remote,
            "installed": r["source"] in catalog_data.ON_DISK or name in dirs,
            "own": r["source"] == "custom",
            "catalog": {
                "name": {"cs": r["label_cs"], "en": r["label_en"]},
                "description": {"cs": r["description_cs"],
                                "en": r["description_en"]},
                "tags": module_tags.for_module(module_id),
                "screenshots": shots,
            },
        }
        (own if entry["own"] else community).append(entry)
    return {"community": community, "own": own, "error": None}


def lookup(name: str):
    """The catalog row for a module name, or None."""
    db.init()
    return catalog_data.get_by_name(name)


def asset_dir(name: str) -> str:
    d = os.path.join(paths.MODULE_ASSETS_DIR, name)
    os.makedirs(d, exist_ok=True)
    return d
