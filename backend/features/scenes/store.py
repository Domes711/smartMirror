"""Scenes: CRUD for placed module instances + per-profile layouts.

Terminology (from the design spec):

  scene            one set of placed modules for a profile — either bound to a
                   time window (`scene_windows`) or the profile's fallback
                   (`scene_default_entries`, the "Výchozí" button in the app).
  instance         a configured module (module + field values) that scenes
                   place.

The on-the-wire shape:

    {"defaults": {<profile>: [{id, position}]},
     "windows":  {<profile>: {<name>: {from, to, label, layout: [{id, position}]}}},
     "instances": [{id, type, profile, values, placement}]}

`type` on the wire is the module's **name** (`clock`, `MMM-Mail`), which is
what codegen and the app speak. In the DB an instance references
`module_catalog.id`, so this module translates between the two — nothing
above it needs to know about catalog ids.

All SQL lives in `data/`; this module is the scenes feature's rules:
validation, reserved names and assembling the wire document.
"""

import logging

from data import (module_catalog, profiles as profiles_data,
                  scene_default_entries, scene_instances, scene_window_entries,
                  scene_windows)
from shared import db

log = logging.getLogger("scenes.store")

DEFAULT_PROFILE = "default"

# Top-level keys pages.js reserves for itself. A profile named like one of
# these would shadow the real block when the file is generated, so the name
# is rejected at the door rather than quietly dropped at codegen time.
RESERVED_PROFILE_NAMES = ("defaults", "globalLayout")

MM_POSITIONS = [
    "top_bar", "top_left", "top_center", "top_right",
    "upper_third", "middle_center", "lower_third",
    "bottom_left", "bottom_center", "bottom_right", "bottom_bar",
]

# Shown on a fresh install so the mirror is not blank before the user opens
# the scene editor.
SEED_WINDOW = {
    "from": "0 0 * * *", "to": "59 23 * * *", "label": "Celý den",
    "layout": [{"id": "clock", "position": "top_left"}],
}


# --------------------------------------------------------------------------- #
# profiles (shared table — camera and scenes both reference it)
# --------------------------------------------------------------------------- #
def list_profile_names() -> list:
    return profiles_data.names()


def ensure_profile(name: str, conn=None) -> None:
    profiles_data.ensure(name, conn=conn)


def remove_profile(name: str) -> None:
    """Delete a profile. ON DELETE CASCADE drops its instances, windows,
    layout entries, photos and hardware overrides — the integrity the JSON
    store never had (deleting a person used to leave orphan layouts).

    Refusing to remove the fallback profile is a rule, so it lives here and
    not in `data/`.
    """
    if profiles_data.is_default(name):
        raise ValueError("výchozího uživatele nelze odebrat")
    profiles_data.delete(name)


# --------------------------------------------------------------------------- #
# read
# --------------------------------------------------------------------------- #
def load() -> dict:
    """Assemble the full store dict from the normalized tables."""
    db.init()
    instances = [
        {"id": i["id"], "type": i["module"], "profile": i["profile"],
         "values": i["values"], "placement": i["placement"]}
        for i in scene_instances.list_with_module_name()
    ]

    defaults: dict = {p: [] for p in profiles_data.names()}
    for profile, entries in scene_default_entries.all_by_profile().items():
        defaults.setdefault(profile, []).extend(
            {"id": e["instance_id"], "position": e["position"]}
            for e in entries)

    windows: dict = {}
    for w in scene_windows.list_all():
        layout = [{"id": e["instance_id"], "position": e["position"]}
                  for e in scene_window_entries.for_window(w["id"])]
        windows.setdefault(w["profile"], {})[w["window_name"]] = {
            "from": w["from_cron"], "to": w["to_cron"],
            "label": w["label"], "layout": layout,
        }

    return {"defaults": defaults, "windows": windows, "instances": instances}


# --------------------------------------------------------------------------- #
# write
# --------------------------------------------------------------------------- #
def save(store: dict) -> None:
    """Replace the whole store in one transaction.

    The editor sends the complete document on every save (it always did), so a
    full replace is both simplest and race-free: a partial diff would have to
    reconcile instance deletions against layout references, which the FK
    cascade does for us here.
    """
    db.init()
    instances = store.get("instances") or []
    defaults = store.get("defaults") or {}
    windows = store.get("windows") or {}

    # Wire `type` is a module name; instances reference catalog ids.
    module_ids = {m["module_name"]: m["id"] for m in module_catalog.list_all()}

    with db.tx() as conn:
        # Profiles first — every layout row FKs into them.
        for name in set(defaults) | set(windows) | {DEFAULT_PROFILE}:
            profiles_data.ensure(name, conn=conn)

        scene_window_entries.delete_all(conn=conn)
        scene_default_entries.delete_all(conn=conn)
        scene_windows.delete_all(conn=conn)

        # Instances are per-profile, so a save must only replace the profiles
        # it actually carries. Deleting the whole table would wipe every other
        # profile's configured modules — including their credentials.
        touched = {inst.get("profile") or DEFAULT_PROFILE for inst in instances}
        for profile in touched:
            profiles_data.ensure(profile, conn=conn)
            scene_instances.delete_for_profile(profile, conn=conn)

        for inst in instances:
            profile = inst.get("profile") or DEFAULT_PROFILE
            module_id = module_ids.get(inst.get("type"))
            if module_id is None:
                # validate() rejects this first; a save reaching here means
                # the catalog row vanished mid-request. Dropping the instance
                # beats aborting the whole save.
                log.warning("instance %s: unknown module %r — skipped",
                            inst.get("id"), inst.get("type"))
                continue
            scene_instances.insert(
                inst["id"], module_id, profile, inst.get("values") or {},
                inst.get("placement") or "region", conn=conn)

        # Layout entries may reference instances owned by profiles this save
        # did not touch, so validate against the table, not just the payload.
        known = scene_instances.ids(conn=conn)

        for profile, layout in defaults.items():
            for sort, entry in enumerate(layout or []):
                if entry.get("id") not in known:
                    continue   # dangling reference — dropped, not an error
                scene_default_entries.insert(
                    profile, entry["id"], entry.get("position", ""), sort,
                    conn=conn)

        for profile, wins in windows.items():
            for wname, w in (wins or {}).items():
                wid = scene_windows.insert(
                    profile, wname, w.get("from", ""), w.get("to", ""),
                    w.get("label") or "", conn=conn)
                for sort, entry in enumerate(w.get("layout") or []):
                    if entry.get("id") not in known:
                        continue
                    scene_window_entries.insert(
                        wid, entry["id"], entry.get("position", ""), sort,
                        conn=conn)


def remove_instances_of_type(mtype: str) -> set:
    """Drop every instance of a module (used when uninstalling it).

    Deliberately profile-blind: uninstalling deletes the cloned repo, so the
    module stops working for everyone. Keeping one profile's instance alive
    would leave a row pointing at code that is no longer on disk.
    """
    db.init()
    module_id = module_catalog.id_for(mtype)
    if module_id is None:
        return set()
    return scene_instances.delete_for_module(module_id)


def seed_if_empty() -> bool:
    """Write the starter scene on a fresh DB. Returns True if it seeded."""
    db.init()
    if scene_windows.any_exist():
        return False
    save({
        "instances": [{"id": "clock", "type": "clock", "values": {}}],
        "defaults": {},
        "windows": {DEFAULT_PROFILE: {"all_day": SEED_WINDOW}},
    })
    log.info("seeded starter scene (default/all_day)")
    return True


# --------------------------------------------------------------------------- #
# validation
# --------------------------------------------------------------------------- #
def validate(store: dict, catalog_by_type: dict):
    """Return an error string, or None if the store is valid."""
    if not isinstance(store, dict):
        return "store must be an object"
    for profile in set(store.get("defaults") or {}) | set(store.get("windows") or {}):
        if profile in RESERVED_PROFILE_NAMES:
            return f"vyhrazené jméno profilu: {profile}"
    seen_ids = set()
    for inst in store.get("instances") or []:
        iid, mtype = inst.get("id"), inst.get("type")
        if not iid:
            return "instance without id"
        if iid in seen_ids:
            return f"duplicate instance id: {iid}"
        seen_ids.add(iid)
        cat = catalog_by_type.get(mtype)
        if not cat:
            return f"unknown module type: {mtype}"
        for fld in cat.get("fields") or []:
            if fld.get("required") and not (inst.get("values") or {}).get(fld["key"]):
                return (f"{cat.get('label') or mtype}: chybí povinné pole "
                        f"'{fld.get('label') or fld['key']}'")
    for profile, layout in (store.get("defaults") or {}).items():
        for entry in layout or []:
            if entry.get("position") not in MM_POSITIONS:
                return f"{profile}/výchozí: neplatná pozice {entry.get('position')}"
    for profile, wins in (store.get("windows") or {}).items():
        for name, w in (wins or {}).items():
            if not w.get("from") or not w.get("to"):
                return f"{profile}/{name}: chybí from/to"
            for entry in w.get("layout") or []:
                if entry.get("position") not in MM_POSITIONS:
                    return f"{profile}/{name}: neplatná pozice {entry.get('position')}"
    return None
