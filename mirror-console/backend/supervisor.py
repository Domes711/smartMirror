#!/usr/bin/env python3
"""Camera supervisor / arbiter for the smart mirror console.

The RPi camera is exclusive — only one process may open it at a time. This
supervisor is the single authority over the camera. It holds a *mode* and
guarantees exactly one consumer owns the camera:

    face_detect   -> release camera, start the production `face_reco` daemon
    test_face     -> stop the daemon, open camera here, stream with face overlay
    test_gesture  -> stop the daemon, open camera here, stream with hand/finger overlay

It serves a small HTTP API on 127.0.0.1:8001 (reached from the LAN through the
Node/Express front-end, which proxies to it):

    GET  /mode          -> {"mode": "..."}
    POST /mode          -> body {"mode": "..."}; switches mode, returns state
    GET  /healthz       -> {"mode","camera_open","daemon_active","fps", ...}
    GET  /stream.mjpg   -> multipart MJPEG (only meaningful in a test_* mode)

The mode is persisted to `mode.state` next to this file, so the supervisor
restores it on boot. Default (no state file) is `face_detect` so the mirror
behaves normally after a power-on.

Reused logic from the on-demand camera scripts (imported from ../camera):
    count_fingers()  from gesture_reco_once.py
    encodings pickle loaded the same way as face_reco_daemon.py
"""

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from http import server
import socketserver

# --- locate the sibling camera/ dir to reuse finger-counting + encodings ---
_HERE = os.path.dirname(os.path.abspath(__file__))
_CAMERA_DIR = os.environ.get(
    "MIRROR_CAMERA_DIR",
    os.path.normpath(os.path.join(_HERE, "..", "..", "camera")),
)
if _CAMERA_DIR not in sys.path:
    sys.path.insert(0, _CAMERA_DIR)

# count_fingers() is imported lazily inside the gesture capture branch (see
# _capture_loop) so the supervisor — and the face/daemon modes — start even if
# the camera scripts' optional deps (paho, mediapipe) aren't importable.

# --- config ---
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8001
STATE_FILE = os.path.join(_HERE, "mode.state")

FACE_SERVICE = "face_reco"
RADAR_SERVICE = "ld2450"
SYSTEMCTL = "/usr/bin/systemctl"

DEFAULT_WIDTH = 640
DEFAULT_HEIGHT = 480
DEFAULT_ENCODINGS = os.path.join(_CAMERA_DIR, "encoded_faces.pickle")
DATASET_DIR = os.path.join(_CAMERA_DIR, "dataset")
ENCODE_SCRIPT = os.path.join(_CAMERA_DIR, "encode_faces.py")
DEFAULT_TOLERANCE = 0.6
FACE_EVERY = 5            # run face detection every Nth frame (hog is slow)
HAND_CONFIDENCE = 0.6
CAMERA_OPEN_RETRIES = 10  # wait for the daemon to release /dev after stop

# "learn" is a streaming mode used by the face-enrollment flow; it is not shown
# in the web mode switcher, only entered by the learning UI.
MODES = ("face_detect", "test_face", "test_gesture", "learn")
DEFAULT_MODE = "face_detect"

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_FILE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,60}\.(jpg|jpeg|png)$", re.IGNORECASE)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s supervisor: %(message)s",
)
log = logging.getLogger("supervisor")


# --------------------------------------------------------------------------- #
# MJPEG plumbing
# --------------------------------------------------------------------------- #
class StreamingOutput:
    """Holds the latest JPEG frame; stream handlers wait on the condition."""

    def __init__(self):
        self.frame = None
        self.condition = threading.Condition()

    def write(self, buf: bytes) -> None:
        with self.condition:
            self.frame = buf
            self.condition.notify_all()


# --------------------------------------------------------------------------- #
# systemd helpers
# --------------------------------------------------------------------------- #
def _systemctl(action: str, service: str = FACE_SERVICE) -> None:
    """Run `sudo -n systemctl <action> <service>` (allowed via sudoers).

    `-n` keeps sudo non-interactive: if the sudoers rule isn't installed yet it
    fails immediately instead of blocking on a password prompt with no TTY
    (which would otherwise hang startup before the HTTP server comes up).
    """
    try:
        res = subprocess.run(
            ["sudo", "-n", SYSTEMCTL, action, service],
            check=False, capture_output=True, text=True,
            stdin=subprocess.DEVNULL, timeout=15,
        )
        if res.returncode == 0:
            log.info("systemctl %s %s", action, service)
        else:
            log.warning("systemctl %s %s failed (rc=%d): %s", action,
                        service, res.returncode, (res.stderr or "").strip())
    except Exception as exc:  # noqa: BLE001
        log.warning("systemctl %s %s failed: %s", action, service, exc)


def service_active(service: str = FACE_SERVICE) -> bool:
    try:
        out = subprocess.run(
            [SYSTEMCTL, "is-active", service],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() == "active"
    except Exception:  # noqa: BLE001
        return False


def _service_exists(name: str) -> bool:
    """True if the systemd unit <name>.service is installed."""
    try:
        out = subprocess.run(
            [SYSTEMCTL, "list-unit-files", f"{name}.service"],
            capture_output=True, text=True, timeout=10,
        )
        return f"{name}.service" in out.stdout
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------- #
# Layout editor: generates pages.js + console-modules.js for MMM-Profile
# --------------------------------------------------------------------------- #
MAGICMIRROR_DIR = os.environ.get(
    "MAGICMIRROR_DIR",
    os.path.normpath(os.path.join(_HERE, "..", "..", "MagicMirror")),
)
MODULES_DIR = os.path.join(MAGICMIRROR_DIR, "modules")
PAGES_PATH = os.path.join(MODULES_DIR, "MMM-Profile", "pages.js")
CONSOLE_MODULES_PATH = os.path.join(MAGICMIRROR_DIR, "config", "console-modules.js")
CONFIG_JS_PATH = os.path.join(MAGICMIRROR_DIR, "config", "config.js")
LAYOUT_STORE_PATH = os.path.join(_HERE, "layout_store.json")
# Per-Pi catalog of modules installed from the Module Store (gitignored). Merged
# into the effective catalog so installed community modules flow through the same
# layout-editor / config-injection machinery as the built-in catalog entries.
INSTALLED_MODULES_PATH = os.path.join(_HERE, "installed_modules.json")
PM2_APP = os.environ.get("PM2_APP", "MagicMirror")

# Module Store: community catalog + image host (MagicMirror 3rd-party modules).
STORE_CATALOG_URL = os.environ.get(
    "STORE_CATALOG_URL", "https://modules.magicmirror.builders/data/modules.json")
STORE_IMAGE_BASE = os.environ.get(
    "STORE_IMAGE_BASE", "https://modules.magicmirror.builders/images/")
_STORE_TTL = 1800  # seconds to cache the fetched community catalog
# Local store metadata: store/modules/<name>/mm-store.json (gitignored per-module).
STORE_MODULES_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "store", "modules"))
# A module directory/name we are willing to clone + place on disk.
_MODULE_NAME_RE = re.compile(r"^MMM-[A-Za-z0-9_.-]{1,60}$")
# Dirs under modules/ that are not third-party (built-ins live in default/).
_NON_MODULE_DIRS = {"default", "node_modules", ".git"}

MM_POSITIONS = [
    "top_bar", "top_left", "top_center", "top_right",
    "upper_third", "middle_center", "lower_third",
    "bottom_left", "bottom_center", "bottom_right", "bottom_bar",
]

# Placeable module types. `fields` drive the "fill required config" modal;
# required fields are enforced before a module can be added.
MODULE_CATALOG = [
    {"type": "clock", "module": "clock", "label": "Hodiny", "fields": []},
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
        {"key": "stopId", "label": "ID zastávky", "required": True}]},
    {"type": "MMM-Package-Tracker", "module": "MMM-Package-Tracker",
     "label": "Zásilky", "fields": [
        {"key": "apiKey", "label": "AfterShip API key", "required": True},
        {"key": "entity", "label": "HA todo (balíčky)", "required": True}]},
    {"type": "weather", "module": "weather", "label": "Počasí", "fields": [
        {"key": "apiKey", "label": "OWM API key", "required": True},
        {"key": "lat", "label": "Lat", "required": True},
        {"key": "lon", "label": "Lon", "required": True}]},
]
def load_installed_modules() -> list:
    """Per-Pi catalog of Module-Store-installed modules (see INSTALLED_MODULES_PATH)."""
    try:
        with open(INSTALLED_MODULES_PATH) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception as exc:  # noqa: BLE001
        log.warning("installed_modules load failed: %s", exc)
        return []


def save_installed_modules(mods: list) -> None:
    with open(INSTALLED_MODULES_PATH, "w") as f:
        json.dump(mods, f, indent=2)


# Extra catalog entries for modules built by the AI module builder (per-Pi,
# gitignored). The Node finalize step appends to this; we merge it in at request
# time so freshly-built modules become placeable without a restart.
CUSTOM_MODULES_PATH = os.path.join(_HERE, "custom_modules.json")


def custom_modules() -> list:
    try:
        with open(CUSTOM_MODULES_PATH) as f:
            data = json.load(f)
        return [c for c in data if isinstance(c, dict) and c.get("type")]
    except FileNotFoundError:
        return []
    except Exception as exc:  # noqa: BLE001
        log.warning("custom_modules.json load failed: %s", exc)
        return []


def effective_catalog() -> list:
    """Built-in catalog + Module-Store-installed modules + AI-built modules, so
    all are placeable in the layout editor and accepted by validate_store.
    Later sources win on a type clash."""
    by_type = {c["type"]: c for c in MODULE_CATALOG}
    for c in load_installed_modules() + custom_modules():
        if not isinstance(c, dict) or not c.get("type"):
            continue
        c.setdefault("fields", [])
        c.setdefault("module", c["type"])
        by_type[c["type"]] = c
    return list(by_type.values())


def catalog_by_type() -> dict:
    return {c["type"]: c for c in effective_catalog()}

DEFAULT_STORE = {
    "globalLayout": [],
    "windows": {
        "default": {
            "all_day": {
                "from": "0 0 * * *", "to": "59 23 * * *",
                "label": "Celý den",
                "layout": [{"id": "clock", "position": "top_left"}],
            }
        }
    },
    "instances": [],
}

_GEN_HEADER = ("/* AUTO-GENERATED by mirror-console — DO NOT EDIT BY HAND.\n"
               "   Manage layout in the console (Profily → Rozložení). */\n")


def _import_pages_windows():
    """Best-effort: read the live MMM-Profile/pages.js (via node) and convert it
    into a store, so the editor shows windows already configured in the mirror."""
    if not os.path.isfile(PAGES_PATH):
        return None
    cmd = (
        'export NVM_DIR="$HOME/.nvm"; '
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '
        'N="${NODE_BIN:-$(command -v node || ls -t "$NVM_DIR"/versions/node/*/bin/node 2>/dev/null | head -1)}"; '
        '[ -n "$N" ] || exit 127; '
        f'"$N" -e \'process.stdout.write(JSON.stringify(require(process.argv[1])))\' "{PAGES_PATH}"'
    )
    try:
        res = subprocess.run(["bash", "-lc", cmd], capture_output=True,
                             text=True, timeout=20, stdin=subprocess.DEVNULL)
        if res.returncode != 0 or not res.stdout.strip():
            return None
        pages = json.loads(res.stdout)
    except Exception:  # noqa: BLE001
        return None
    windows = {}
    for key, block in pages.items():
        if key == "globalLayout" or not isinstance(block, dict):
            continue
        wins = {}
        for name, w in block.items():
            if isinstance(w, dict) and w.get("from") and w.get("to"):
                wins[name] = {"from": w["from"], "to": w["to"], "label": "",
                              "layout": w.get("layout", [])}
        if wins:
            windows[key] = wins
    return {"globalLayout": pages.get("globalLayout", []),
            "windows": windows, "instances": []}


def load_store() -> dict:
    try:
        with open(LAYOUT_STORE_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        imported = _import_pages_windows()
        if imported and imported["windows"]:
            log.info("seeded layout store from existing pages.js")
            return imported
        return json.loads(json.dumps(DEFAULT_STORE))
    except Exception as exc:  # noqa: BLE001
        log.warning("layout store load failed: %s", exc)
        return json.loads(json.dumps(DEFAULT_STORE))


def save_store(store: dict) -> None:
    with open(LAYOUT_STORE_PATH, "w") as f:
        json.dump(store, f, indent=2)


def module_config(mtype: str, values: dict) -> dict:
    """Build a MagicMirror module `config` from the catalog field values."""
    v = values or {}
    if mtype == "MMM-GoogleCalendar":
        return {"calendars": [{"symbol": "calendar-week",
                               "calendarID": v.get("calendarID", "")}]}
    if mtype == "newsfeed":
        return {"feeds": [{"title": v.get("title") or "News",
                           "url": v.get("url", "")}]}
    if mtype == "weather":
        return {"weatherProvider": "openmeteo", "type": "current",
                "lat": v.get("lat"), "lon": v.get("lon"),
                "apiKey": v.get("apiKey")}
    if mtype in ("clock", "compliments"):
        return {}
    return dict(v)  # default: flat passthrough


def registered_ids() -> list:
    """Module ids already taken: scanned from config.js + console store."""
    ids = set()
    try:
        with open(CONFIG_JS_PATH) as f:
            text = f.read()
        ids.update(re.findall(r'id:\s*["\']([^"\']+)["\']', text))
    except Exception:  # noqa: BLE001
        pass
    for inst in load_store().get("instances", []):
        if inst.get("id"):
            ids.add(inst["id"])
    return sorted(ids)


def validate_store(store: dict):
    """Return an error string, or None if the store is valid."""
    if not isinstance(store, dict):
        return "store must be an object"
    by_type = catalog_by_type()
    seen_ids = set()
    for inst in store.get("instances", []):
        iid = inst.get("id")
        mtype = inst.get("type")
        if not iid:
            return "instance without id"
        if iid in seen_ids:
            return f"duplicate instance id: {iid}"
        seen_ids.add(iid)
        cat = by_type.get(mtype)
        if not cat:
            return f"unknown module type: {mtype}"
        for fld in cat["fields"]:
            if fld.get("required") and not (inst.get("values") or {}).get(fld["key"]):
                return f"{cat['label']}: chybí povinné pole '{fld['label']}'"
    for profile, wins in store.get("windows", {}).items():
        for name, w in (wins or {}).items():
            if not w.get("from") or not w.get("to"):
                return f"{profile}/{name}: chybí from/to"
            for entry in w.get("layout", []):
                if entry.get("position") not in MM_POSITIONS:
                    return f"{profile}/{name}: neplatná pozice {entry.get('position')}"
    return None


def _pages_object(store: dict) -> dict:
    out = {"globalLayout": store.get("globalLayout", [])}
    for profile, wins in store.get("windows", {}).items():
        out[profile] = {}
        for name, w in (wins or {}).items():
            out[profile][name] = {"from": w["from"], "to": w["to"],
                                  "layout": w.get("layout", [])}
    return out


def _console_modules_array(store: dict) -> list:
    mods = []
    by_type = catalog_by_type()
    for inst in store.get("instances", []):
        cat = by_type.get(inst.get("type"), {})
        mods.append({
            "id": inst["id"],
            "module": cat.get("module", inst.get("type")),
            "position": "top_center",  # initial; MMM-Profile repositions per pages.js
            "config": module_config(inst.get("type"), inst.get("values")),
        })
    return mods


def _node_require_ok(path: str) -> bool:
    """True if `node -e require(path)` succeeds (config still valid)."""
    cmd = (
        'export NVM_DIR="$HOME/.nvm"; '
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '
        'N="${NODE_BIN:-$(command -v node || ls -t "$NVM_DIR"/versions/node/*/bin/node 2>/dev/null | head -1)}"; '
        '[ -n "$N" ] || exit 0; '  # no node → don't block (can't validate)
        f'"$N" -e \'require(process.argv[1])\' "{path}"'
    )
    try:
        r = subprocess.run(["bash", "-lc", cmd], capture_output=True,
                           text=True, timeout=20, stdin=subprocess.DEVNULL)
        return r.returncode == 0
    except Exception:  # noqa: BLE001
        return False


CONSOLE_START = "// MIRROR-CONSOLE:START"
CONSOLE_END = "// MIRROR-CONSOLE:END"


def _managed_block(store: dict) -> str:
    """Literal JS for the console-managed module instances (between markers).

    These go DIRECTLY into config.js (not a require()d file) because
    MagicMirror's config loader does not resolve a relative require() inside
    config.js — so a spread returned [] and modules never loaded.
    """
    lines = [CONSOLE_START + " (auto-managed — module instances from the layout editor; do not edit)"]
    by_type = catalog_by_type()
    for inst in store.get("instances", []):
        cat = by_type.get(inst.get("type"), {})
        obj = {
            "id": inst["id"],
            "module": cat.get("module", inst.get("type")),
            "position": "top_center",  # initial; MMM-Profile repositions per pages.js
            "config": module_config(inst.get("type"), inst.get("values")),
        }
        lines.append("        " + json.dumps(obj, ensure_ascii=False) + ",")
    lines.append("        " + CONSOLE_END)
    return "\n".join(lines)


def inject_managed_modules(store: dict) -> None:
    """Replace the MIRROR-CONSOLE block in config.js with the current module
    instances (literal objects). Idempotent; backup + node-validate + revert."""
    path = CONFIG_JS_PATH
    try:
        with open(path) as f:
            text = f.read()
    except Exception:  # noqa: BLE001
        return
    block = _managed_block(store)
    if CONSOLE_START in text and CONSOLE_END in text:
        new = re.sub(re.escape(CONSOLE_START) + r".*?" + re.escape(CONSOLE_END),
                     lambda _m: block, text, count=1, flags=re.S)
    elif re.search(r'modules:\s*\[', text):
        new = re.sub(r'(modules:\s*\[)', lambda m: m.group(1) + "\n        " + block,
                     text, count=1)
    else:
        log.warning("config.js: no modules[] / markers — skipping module inject")
        return
    if new == text:
        return
    bak = f"{path}.bak.{int(time.time())}"
    try:
        with open(bak, "w") as f:
            f.write(text)
        with open(path, "w") as f:
            f.write(new)
        if _node_require_ok(path):
            log.info("config.js: injected %d managed module(s)",
                     len(store.get("instances", [])))
        else:
            with open(path, "w") as f:
                f.write(text)
            log.warning("config.js inject broke it — reverted (backup %s)", bak)
    except Exception as exc:  # noqa: BLE001
        log.warning("config.js inject failed: %s", exc)


def _managed_ids(text: str) -> set:
    """Module ids currently in the config.js MIRROR-CONSOLE block."""
    m = re.search(re.escape(CONSOLE_START) + r"(.*?)" + re.escape(CONSOLE_END), text, re.S)
    return set(re.findall(r'"id"\s*:\s*"([^"]+)"', m.group(1))) if m else set()


def generate_files(store: dict) -> None:
    """Write pages.js from the store and inject module instances into config.js."""
    pages_js = _GEN_HEADER + "module.exports = " + \
        json.dumps(_pages_object(store), indent=4, ensure_ascii=False) + ";\n"
    os.makedirs(os.path.dirname(PAGES_PATH), exist_ok=True)
    with open(PAGES_PATH, "w") as f:
        f.write(pages_js)
    inject_managed_modules(store)
    log.info("generated pages.js + injected modules into config.js")


# --------------------------------------------------------------------------- #
# Module Store: browse the MagicMirror 3rd-party catalog, install / uninstall
# --------------------------------------------------------------------------- #
_store_cache = {"ts": 0.0, "data": None}
_install_lock = threading.Lock()
_install_jobs = {}  # module id -> {phase, percent, done, ok, error, name}


def _fetch_community_catalog() -> list:
    """Download (and cache) the community module catalog JSON."""
    now = time.time()
    cached = _store_cache["data"]
    if cached is not None and now - _store_cache["ts"] < _STORE_TTL:
        return cached
    import urllib.request
    req = urllib.request.Request(
        STORE_CATALOG_URL, headers={"User-Agent": "mirror-console"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    if isinstance(data, dict):  # catalog is {"modules": [...]}
        data = data.get("modules", [])
    if not isinstance(data, list):
        data = []
    _store_cache["data"] = data
    _store_cache["ts"] = now
    return data


def _load_local_meta(name: str):
    """Load store/modules/<name>/mm-store.json and resolve screenshot paths.
    Returns the parsed dict (screenshots rewritten to /store-assets/ URLs) or None."""
    p = os.path.join(STORE_MODULES_DIR, name, "mm-store.json")
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data.get("screenshots"), list):
            data["screenshots"] = [
                f"/store-assets/{urllib.parse.quote(name)}/{s}"
                for s in data["screenshots"]
                if isinstance(s, str)
            ]
        return data
    except Exception:  # noqa: BLE001
        return None


def _community_entry(e: dict) -> dict:
    name = e.get("name") or ""
    img = e.get("image")
    return {
        "id": e.get("id") or name,
        "name": name,
        "url": e.get("url") or "",
        "description": e.get("description") or "",
        "category": e.get("category") or "",
        "maintainer": e.get("maintainer") or "",
        "stars": e.get("stars"),
        "image": (STORE_IMAGE_BASE + urllib.parse.quote(img)) if img else None,
        "catalog": _load_local_meta(e.get("id") or name),
    }


def _installed_dirs() -> set:
    try:
        return {d for d in os.listdir(MODULES_DIR)
                if os.path.isdir(os.path.join(MODULES_DIR, d))}
    except Exception:  # noqa: BLE001
        return set()


def _readme_short(module_dir: str) -> str:
    """First meaningful prose line of a module's README (for the own-module card)."""
    for fn in ("README.md", "readme.md", "Readme.md"):
        p = os.path.join(module_dir, fn)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                for line in f:
                    s = line.strip()
                    if s and not s.startswith(("#", "!", "[", "<", "-", "=", "`")):
                        return s[:240]
        except Exception:  # noqa: BLE001
            pass
        break
    return ""


# Locally generated store screenshots, in display order, produced by the AI
# module builder/editor (server/module-ai.js).
_THUMB_FILES = ("store-thumb.png", "store-thumb-2.png")


def _local_thumbs(name: str) -> list:
    """URLs of the locally generated store screenshots that actually exist."""
    out = []
    for fn in _THUMB_FILES:
        if os.path.isfile(os.path.join(MODULES_DIR, name, fn)):
            out.append(f"/module-installed/{name}/{fn}")
    return out


def _local_thumb(name: str):
    """URL of the primary local screenshot, or None if none exists."""
    thumbs = _local_thumbs(name)
    return thumbs[0] if thumbs else None


def _own_entry(d: str) -> dict:
    thumbs = _local_thumbs(d)
    return {
        "id": d, "name": d, "url": "",
        "description": _readme_short(os.path.join(MODULES_DIR, d)),
        "category": "Moje", "maintainer": "", "stars": None,
        "image": thumbs[0] if thumbs else None, "images": thumbs,
        "installed": True, "own": True,
        "catalog": _load_local_meta(d),
    }


def store_catalog() -> dict:
    """Two lists: `community` (the internet catalog, each flagged `installed`) and
    `own` (local module dirs not published in the community catalog)."""
    try:
        community_raw = _fetch_community_catalog()
        err = None
    except Exception as exc:  # noqa: BLE001
        community_raw, err = [], str(exc)
    dirs = _installed_dirs()
    community, community_names = [], set()
    for e in community_raw:
        ce = _community_entry(e)
        if not ce["name"]:
            continue
        community_names.add(ce["name"])
        ce["installed"] = ce["name"] in dirs
        if ce["installed"]:
            thumbs = _local_thumbs(ce["name"])
            if thumbs:
                ce["image"] = thumbs[0]
                ce["images"] = thumbs
        community.append(ce)
    own = [_own_entry(d) for d in sorted(dirs)
           if d.startswith("MMM-")
           and d not in community_names
           and d not in _NON_MODULE_DIRS]
    return {"community": community, "own": own, "error": err}


def _raw_readme_urls(repo_url: str):
    """(candidate raw README URLs, raw base for relative images) for a repo URL."""
    u = (repo_url or "").rstrip("/").removesuffix(".git")
    if "github.com" in u:
        base = u.replace("github.com", "raw.githubusercontent.com")
        return ([f"{base}/{ref}/README.md" for ref in ("HEAD", "master", "main")],
                f"{base}/HEAD/")
    if "gitlab.com" in u:
        return ([f"{u}/-/raw/{ref}/README.md" for ref in ("HEAD", "master", "main")],
                f"{u}/-/raw/HEAD/")
    return [], ""


def store_readme(mid: str, url: str = "") -> dict:
    """README markdown for a module. Local file for own modules, GitHub/GitLab
    raw for community ones. `baseUrl` lets the UI resolve relative image paths."""
    safe = (mid or "").split("/")[-1]
    if "/" not in (mid or "") and _MODULE_NAME_RE.match(safe):
        local = os.path.join(MODULES_DIR, safe)
        if os.path.isdir(local):
            for fn in ("README.md", "readme.md", "Readme.md"):
                p = os.path.join(local, fn)
                if os.path.isfile(p):
                    with open(p, encoding="utf-8", errors="replace") as f:
                        return {"markdown": f.read(), "baseUrl": ""}
            return {"markdown": "", "baseUrl": ""}
    import urllib.request
    urls, base = _raw_readme_urls(url)
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "mirror-console"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return {"markdown": r.read().decode("utf-8", "replace"), "baseUrl": base}
        except Exception:  # noqa: BLE001
            continue
    return {"markdown": "", "baseUrl": base}


def _lookup_community(mid: str):
    for e in _fetch_community_catalog():
        if (e.get("id") or e.get("name")) == mid:
            return e
    return None


def _set_job(mid: str, **kw) -> None:
    with _install_lock:
        _install_jobs.setdefault(mid, {}).update(kw)


def _unique_instance_id(name: str, store: dict) -> str:
    base = name.lower()
    taken = set(registered_ids()) | {i.get("id") for i in store.get("instances", [])}
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


def _register_installed(name: str) -> None:
    """Record an installed module in the catalog, add a bare instance + a
    globalLayout slot so it shows after restart, then regenerate the files.
    Configuration / placement is refined later in the layout editor."""
    mods = load_installed_modules()
    if not any(m.get("type") == name for m in mods):
        mods.append({"type": name, "module": name, "label": name, "fields": []})
        save_installed_modules(mods)
    store = load_store()
    insts = store.setdefault("instances", [])
    if not any(i.get("type") == name for i in insts):
        iid = _unique_instance_id(name, store)
        insts.append({"id": iid, "type": name, "values": {}})
        save_store(store)
    generate_files(store)


def _npm_install(cwd: str) -> tuple:
    cmd = (
        'export NVM_DIR="$HOME/.nvm"; '
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '
        'NPM="${NPM_BIN:-$(command -v npm || ls -t "$NVM_DIR"/versions/node/*/bin/npm 2>/dev/null | head -1)}"; '
        '[ -n "$NPM" ] || { echo "npm not found"; exit 127; }; '
        '"$NPM" install --omit=dev --no-audit --no-fund'
    )
    res = subprocess.run(["bash", "-lc", cmd], cwd=cwd, capture_output=True,
                         text=True, timeout=900, stdin=subprocess.DEVNULL)
    return res.returncode, ((res.stdout or "") + (res.stderr or ""))


def _install_worker(mid: str, url: str, name: str, dest: str) -> None:
    import shutil
    try:
        _set_job(mid, phase="cloning", percent=10)
        r = subprocess.run(["git", "clone", "--depth", "1", url, dest],
                           capture_output=True, text=True, timeout=300,
                           stdin=subprocess.DEVNULL)
        if r.returncode != 0:
            raise RuntimeError("git clone selhal: " + (r.stderr or "")[-400:])
        _set_job(mid, phase="cloned", percent=40)
        if os.path.isfile(os.path.join(dest, "package.json")):
            _set_job(mid, phase="npm", percent=50)
            rc, out = _npm_install(dest)
            if rc != 0:
                raise RuntimeError("npm install selhal: " + out[-400:])
        _set_job(mid, phase="config", percent=88)
        _register_installed(name)
        _set_job(mid, phase="restarting", percent=94)
        res = Supervisor._pm2_restart()
        if not res.get("ok"):
            raise RuntimeError("restart selhal: " + res.get("output", ""))
        # Ask the Express server to run the adopt agent (demo.html + CLAUDE.md
        # analysis) on the freshly installed module. Fire-and-forget — the agent
        # runs on the background; the install is already complete.
        _set_job(mid, phase="analysing", percent=97)
        try:
            import urllib.request as _req
            _adopt_body = json.dumps({"name": name}).encode()
            _adopt_rq = _req.Request(
                "http://127.0.0.1:8000/api/modules/adopt",
                data=_adopt_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            _req.urlopen(_adopt_rq, timeout=10)
        except Exception as _e:  # noqa: BLE001
            log.warning("adopt trigger failed (non-fatal): %s", _e)
        _set_job(mid, phase="done", percent=100, done=True, ok=True)
        log.info("installed module %s", name)
    except Exception as exc:  # noqa: BLE001
        try:
            if os.path.isdir(dest):
                shutil.rmtree(dest)
        except Exception:  # noqa: BLE001
            pass
        _set_job(mid, phase="error", percent=100, done=True, ok=False, error=str(exc))
        log.warning("install %s failed: %s", name, exc)


# --------------------------------------------------------------------------- #
# Supervisor: owns the mode + the camera capture thread
# --------------------------------------------------------------------------- #
class Supervisor:
    def __init__(self, args):
        self.args = args
        self.output = StreamingOutput()
        self.lock = threading.RLock()          # serialize mode transitions
        self.mode = DEFAULT_MODE
        # Single persistent camera instance + single capture thread. We never
        # close/reopen the camera just to switch between test modes (libcamera
        # struggles to re-acquire in the same process); instead we keep one
        # instance and only flip self.overlay.
        self.picam = None
        self.overlay = None                    # "face" | "gesture" | "learn" | None
        self.last_raw = None                   # latest clean frame (for enrollment capture)
        self.capture_thread = None
        self.stop_capture = threading.Event()
        self.camera_open = False
        self.fps = 0.0
        # cached detectors (lazy, kept across overlay switches)
        self._mp = None
        self._hands = None
        self._count_fingers = None
        self._fr = None
        self._known_encodings = None
        self._known_names = None
        self._last_faces = []

    # ---- persistence -------------------------------------------------- #
    def load_mode(self) -> str:
        try:
            with open(STATE_FILE) as f:
                m = f.read().strip()
            if m in MODES:
                return m
        except FileNotFoundError:
            pass
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read state file: %s", exc)
        return DEFAULT_MODE

    def save_mode(self, mode: str) -> None:
        try:
            with open(STATE_FILE, "w") as f:
                f.write(mode)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not write state file: %s", exc)

    # ---- mode transitions --------------------------------------------- #
    def apply_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown mode: {mode}")
        with self.lock:
            log.info("switching mode: %s -> %s", self.mode, mode)

            if mode in ("test_face", "test_gesture", "learn"):
                # A streaming mode owns the camera. If the daemon exists, stop
                # it so it isn't holding the device, then reuse our single
                # camera instance and just flip the overlay (no close/reopen).
                if _service_exists(FACE_SERVICE):
                    _systemctl("stop")
                self.overlay = {
                    "test_face": "face",
                    "test_gesture": "gesture",
                    "learn": "learn",
                }[mode]
                self._ensure_capture()
            elif mode == "face_detect":
                # Hand the camera to the production daemon (if installed).
                self.overlay = None
                self._pause_capture()
                if _service_exists(FACE_SERVICE):
                    self._release_camera()   # fully close so the daemon can acquire
                    _systemctl("start")
                # else: no daemon here — keep the (paused) instance so switching
                # back to a test mode is instant and reliable.

            self.mode = mode
            self.save_mode(mode)
            log.info("mode active: %s", mode)

    # ---- camera + capture lifecycle ----------------------------------- #
    def _ensure_camera(self) -> None:
        """Open the single persistent Picamera2 instance, or resume it."""
        if self.picam is not None:
            if not self.camera_open:
                self.picam.start()
                self.camera_open = True
            return
        from picamera2 import Picamera2
        last_exc = None
        for attempt in range(CAMERA_OPEN_RETRIES):
            picam = None
            try:
                picam = Picamera2()
                config = picam.create_preview_configuration(
                    main={"size": (self.args.width, self.args.height),
                          "format": "RGB888"}
                )
                picam.configure(config)
                picam.start()
                self.picam = picam
                self.camera_open = True
                log.info("camera open (%dx%d)", self.args.width,
                         self.args.height)
                return
            except Exception as exc:  # noqa: BLE001 -- device may be busy
                last_exc = exc
                if picam is not None:
                    try:
                        picam.close()
                    except Exception:  # noqa: BLE001
                        pass
                log.info("camera busy, retry %d/%d", attempt + 1,
                         CAMERA_OPEN_RETRIES)
                time.sleep(0.5)
        raise RuntimeError(f"could not open camera: {last_exc}")

    def _ensure_capture(self) -> None:
        """Open the camera and start the capture thread if not running."""
        self._ensure_camera()
        if self.capture_thread is None or not self.capture_thread.is_alive():
            self.stop_capture.clear()
            self.capture_thread = threading.Thread(
                target=self._capture_loop, daemon=True)
            self.capture_thread.start()

    def _pause_capture(self) -> None:
        """Stop the capture thread and pause the camera (keep the instance)."""
        if self.capture_thread and self.capture_thread.is_alive():
            self.stop_capture.set()
            self.capture_thread.join(timeout=5)
        self.capture_thread = None
        if self.picam is not None and self.camera_open:
            try:
                self.picam.stop()
            except Exception:  # noqa: BLE001
                pass
        self.camera_open = False
        self.fps = 0.0

    def _release_camera(self) -> None:
        """Fully close the camera so another process can acquire it."""
        if self.picam is not None:
            try:
                self.picam.close()
            except Exception:  # noqa: BLE001
                pass
            self.picam = None
        self.camera_open = False

    def _capture_loop(self) -> None:
        import cv2
        frame_idx = 0
        last_t = time.monotonic()
        try:
            for _ in range(3):  # discard warm-up frames
                self.picam.capture_array()
            while not self.stop_capture.is_set():
                frame = self.picam.capture_array()  # RGB888 == BGR for cv2
                frame_idx += 1
                overlay = self.overlay
                if overlay == "gesture":
                    self._draw_gesture(cv2, frame)
                elif overlay == "face":
                    self._draw_face(cv2, frame, frame_idx)
                elif overlay == "learn":
                    # snapshot the clean frame BEFORE drawing, for enrollment
                    self.last_raw = frame.copy()
                    self._draw_facebox(cv2, frame, frame_idx)

                now = time.monotonic()
                dt = now - last_t
                last_t = now
                if dt > 0:
                    self.fps = 0.9 * self.fps + 0.1 * (1.0 / dt)
                cv2.putText(
                    frame,
                    f"{self.mode}  {self.args.width}x{self.args.height}  "
                    f"{self.fps:4.1f} fps",
                    (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

                ok, jpg = cv2.imencode(".jpg", frame)
                if ok:
                    self.output.write(jpg.tobytes())
        except Exception as exc:  # noqa: BLE001
            log.exception("capture loop error: %s", exc)
        finally:
            self.fps = 0.0
            log.info("capture loop stopped")

    # ---- overlays (lazy-initialized, cached across switches) ---------- #
    def _draw_gesture(self, cv2, frame) -> None:
        if self._hands is None:
            from gesture_reco_once import count_fingers
            import mediapipe as mp
            self._mp = mp
            self._count_fingers = count_fingers
            self._hands = mp.solutions.hands.Hands(
                static_image_mode=False, max_num_hands=1,
                min_detection_confidence=HAND_CONFIDENCE,
                min_tracking_confidence=HAND_CONFIDENCE,
            )
        mp = self._mp
        results = self._hands.process(frame)
        if results.multi_hand_landmarks:
            for lm, handed in zip(results.multi_hand_landmarks,
                                  results.multi_handedness):
                mp.solutions.drawing_utils.draw_landmarks(
                    frame, lm, mp.solutions.hands.HAND_CONNECTIONS,
                    mp.solutions.drawing_styles.get_default_hand_landmarks_style(),
                    mp.solutions.drawing_styles.get_default_hand_connections_style(),
                )
                n = self._count_fingers(lm, handed)
                cv2.putText(frame, f"fingers: {n}",
                            (10, self.args.height - 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

    def _draw_face(self, cv2, frame, frame_idx) -> None:
        if self._fr is None:
            import face_recognition as fr
            self._fr = fr
            self._known_encodings, self._known_names = self._load_encodings()
        fr = self._fr
        if frame_idx % FACE_EVERY == 0:
            locs = fr.face_locations(
                frame, model="hog", number_of_times_to_upsample=0)
            encs = fr.face_encodings(frame, locs)
            faces = []
            for (top, right, bottom, left), enc in zip(locs, encs):
                name = "unknown"
                if self._known_encodings:
                    matches = fr.compare_faces(
                        self._known_encodings, enc,
                        tolerance=self.args.tolerance)
                    for known, hit in zip(self._known_names, matches):
                        if hit:
                            name = known
                            break
                faces.append((top, right, bottom, left, name))
            self._last_faces = faces
        for (top, right, bottom, left, name) in self._last_faces:
            cv2.rectangle(frame, (left, top), (right, bottom), (255, 128, 0), 2)
            cv2.putText(frame, name, (left, max(top - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 128, 0), 2)

    def _draw_facebox(self, cv2, frame, frame_idx) -> None:
        """Lightweight face box (no recognition) to help framing while learning."""
        if self._fr is None:
            import face_recognition as fr
            self._fr = fr
        if frame_idx % FACE_EVERY == 0:
            self._last_faces = [
                (t, r, b, l, "")
                for (t, r, b, l) in self._fr.face_locations(
                    frame, model="hog", number_of_times_to_upsample=0)
            ]
        for (top, right, bottom, left, _name) in self._last_faces:
            cv2.rectangle(frame, (left, top), (right, bottom), (0, 255, 0), 2)
        cv2.putText(frame, "zarovnej oblicej", (10, self.args.height - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    def _load_encodings(self):
        import pickle
        try:
            with open(self.args.encodings, "rb") as f:
                data = pickle.load(f)
            log.info("loaded %d face encodings: %s", len(data["encodings"]),
                     ", ".join(sorted(set(data["names"]))) or "none")
            return data["encodings"], data["names"]
        except Exception as exc:  # noqa: BLE001
            log.warning("could not load encodings (%s): %s",
                        self.args.encodings, exc)
            return [], []

    # ---- face enrollment (dataset capture / encode) ------------------- #
    @staticmethod
    def _person_dir(name: str) -> str:
        if not _NAME_RE.match(name or ""):
            raise ValueError("invalid name")
        return os.path.join(DATASET_DIR, name)

    def capture_photo(self, name: str, file: str = None) -> dict:
        """Save the current clean frame into dataset/<name>/.

        Without `file`, appends as the next N.jpg. With `file`, overwrites that
        exact filename (used to replace a specific photo).
        """
        import cv2
        if self.overlay != "learn" or self.last_raw is None:
            raise RuntimeError("not in learn mode / no frame yet")
        d = self._person_dir(name)
        os.makedirs(d, exist_ok=True)
        if file:
            if not _FILE_RE.match(file):
                raise ValueError("invalid file")
            fname = file
        else:
            nums = []
            for f in os.listdir(d):
                stem, ext = os.path.splitext(f)
                if ext.lower() in (".jpg", ".jpeg", ".png") and stem.isdigit():
                    nums.append(int(stem))
            fname = f"{(max(nums) + 1) if nums else 1}.jpg"
        # Match capture_photos.py: convert the camera array RGB->BGR before
        # writing, so files stay consistent with the existing dataset/encoder.
        bgr = cv2.cvtColor(self.last_raw, cv2.COLOR_RGB2BGR)
        cv2.imwrite(os.path.join(d, fname), bgr)
        log.info("captured %s/%s", name, fname)
        return {"file": fname, "total": len(self.list_photos(name))}

    def list_photos(self, name: str) -> list:
        d = self._person_dir(name)
        if not os.path.isdir(d):
            return []
        files = [f for f in os.listdir(d)
                 if os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png")]
        return sorted(files, key=lambda f: (
            int(os.path.splitext(f)[0]) if os.path.splitext(f)[0].isdigit() else 0,
            f))

    def delete_photo(self, name: str, file: str) -> None:
        if not _FILE_RE.match(file or ""):
            raise ValueError("invalid file")
        path = os.path.join(self._person_dir(name), file)
        if os.path.isfile(path):
            os.remove(path)
            log.info("deleted %s/%s", name, file)

    def photo_path(self, name: str, file: str) -> str:
        if not _FILE_RE.match(file or ""):
            raise ValueError("invalid file")
        return os.path.join(self._person_dir(name), file)

    def encode_dataset(self) -> dict:
        """Retrain encoded_faces.pickle from the dataset, then drop the cache."""
        try:
            res = subprocess.run(
                [sys.executable, ENCODE_SCRIPT,
                 "--dataset", DATASET_DIR, "--output", self.args.encodings],
                capture_output=True, text=True, timeout=600, cwd=_CAMERA_DIR,
            )
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "output": str(exc)}
        # force reload of cached encodings on next face/learn frame
        self._fr = None
        self._known_encodings = None
        self._known_names = None
        out = (res.stdout or "") + (res.stderr or "")
        return {"ok": res.returncode == 0, "output": out[-4000:]}

    # ---- profiles (one per learned person / dataset folder) ----------- #
    def list_profiles(self) -> list:
        import random
        profiles = []
        if not os.path.isdir(DATASET_DIR):
            return profiles
        for name in sorted(os.listdir(DATASET_DIR)):
            d = os.path.join(DATASET_DIR, name)
            if not os.path.isdir(d) or not _NAME_RE.match(name):
                continue
            photos = [f for f in os.listdir(d)
                      if os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png")]
            if not photos:
                continue
            profiles.append({
                "name": name,
                "count": len(photos),
                "sample": random.choice(photos),  # one random training photo
            })
        return profiles

    def remove_profile(self, name: str) -> dict:
        """Delete the person's dataset folder, then rebuild the encodings so
        the removed face is no longer recognized."""
        import shutil
        d = self._person_dir(name)  # validates name
        if os.path.isdir(d):
            shutil.rmtree(d)
            log.info("removed profile %s", name)
        result = self._rebuild_encodings()
        return {"removed": name, "encode": result,
                "profiles": self.list_profiles()}

    def _rebuild_encodings(self) -> dict:
        """Re-run the encoder, or write an empty pickle if the dataset is now
        empty (encode_faces.py errors out on an empty dataset)."""
        has_images = False
        if os.path.isdir(DATASET_DIR):
            for p in os.listdir(DATASET_DIR):
                pd = os.path.join(DATASET_DIR, p)
                if os.path.isdir(pd) and any(
                    os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png")
                    for f in os.listdir(pd)
                ):
                    has_images = True
                    break
        if not has_images:
            import pickle
            with open(self.args.encodings, "wb") as f:
                pickle.dump({"encodings": [], "names": []}, f)
            self._fr = self._known_encodings = self._known_names = None
            return {"ok": True, "output": "dataset empty — wrote empty encodings"}
        return self.encode_dataset()

    # ---- status ------------------------------------------------------- #
    def health(self) -> dict:
        return {
            "mode": self.mode,
            "modes": list(MODES),
            "camera_open": self.camera_open,
            "daemon_active": service_active(FACE_SERVICE),
            "fps": round(self.fps, 1),
            "width": self.args.width,
            "height": self.args.height,
        }

    # ---- radar control ------------------------------------------------ #
    @staticmethod
    def radar_status() -> dict:
        return {
            "active": service_active(RADAR_SERVICE),
            "available": _service_exists(RADAR_SERVICE),
        }

    @staticmethod
    def set_radar(active: bool) -> dict:
        _systemctl("start" if active else "stop", RADAR_SERVICE)
        return Supervisor.radar_status()

    # ---- layout editor ------------------------------------------------ #
    @staticmethod
    def list_modules() -> dict:
        return {"catalog": effective_catalog(), "registered_ids": registered_ids(),
                "positions": MM_POSITIONS}

    @staticmethod
    def get_layout() -> dict:
        return load_store()

    @staticmethod
    def save_layout(store: dict) -> dict:
        """Persist the draft only — does NOT touch pages.js/config.js (that is
        done by apply). Keeps the editor state across refresh without changing
        what the mirror shows."""
        err = validate_store(store)
        if err:
            raise ValueError(err)
        save_store(store)
        return {"ok": True}

    @staticmethod
    def apply_layout() -> dict:
        """Generate pages.js + console-modules.js from the draft, ensure the
        config spread, then decide: a changed set of module instances needs a
        pm2 restart (to (un)register modules); position/window-only changes just
        need the mirror to reload pages.js (frontend publishes the reload)."""
        store = load_store()
        prev_ids = set()
        try:
            with open(CONFIG_JS_PATH) as f:
                prev_ids = _managed_ids(f.read())
        except Exception:  # noqa: BLE001
            pass

        generate_files(store)   # writes pages.js + injects modules into config.js

        new_ids = {i["id"] for i in store.get("instances", []) if i.get("id")}
        if new_ids != prev_ids:
            res = Supervisor._pm2_restart()
            return {"ok": res["ok"], "restarted": True,
                    "reload_needed": False, "output": res.get("output", "")}
        return {"ok": True, "restarted": False, "reload_needed": True}

    @staticmethod
    def _pm2_restart() -> dict:
        # Under systemd, `bash -lc` does NOT load nvm (it lives in ~/.bashrc,
        # skipped for non-interactive shells), so `pm2` isn't on PATH. Source
        # nvm explicitly and fall back to globbing the nvm node bin for pm2.
        cmd = (
            'export NVM_DIR="$HOME/.nvm"; '
            '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '
            'PM2="${PM2_BIN:-$(command -v pm2 || ls -t "$NVM_DIR"/versions/node/*/bin/pm2 2>/dev/null | head -1)}"; '
            '[ -n "$PM2" ] || { echo "pm2 not found (install pm2 / check nvm)"; exit 127; }; '
            f'"$PM2" restart {PM2_APP}'
        )
        try:
            res = subprocess.run(
                ["bash", "-lc", cmd],
                capture_output=True, text=True, timeout=60,
                stdin=subprocess.DEVNULL,
            )
            out = ((res.stdout or "") + (res.stderr or "")).strip()[-2000:]
            return {"ok": res.returncode == 0, "output": out}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "output": str(exc)}

    # ---- module store ------------------------------------------------- #
    @staticmethod
    def store_catalog() -> dict:
        return store_catalog()

    @staticmethod
    def store_readme(mid: str, url: str = "") -> dict:
        return store_readme(mid, url)

    @staticmethod
    def install_status(mid: str) -> dict:
        with _install_lock:
            job = _install_jobs.get(mid)
            return dict(job) if job else {"phase": "idle", "percent": 0, "done": False}

    @staticmethod
    def install_module(mid: str) -> dict:
        """Validate against the trusted catalog, then clone + install on a
        background thread (poll /store/install/status for progress)."""
        entry = _lookup_community(mid)
        if not entry:
            raise ValueError("modul není v katalogu")
        name = entry.get("name") or ""
        url = entry.get("url") or ""
        if not _MODULE_NAME_RE.match(name):
            raise ValueError(f"neplatné jméno modulu: {name}")
        if not (url.startswith("https://github.com/")
                or url.startswith("https://gitlab.com/")):
            raise ValueError("nepodporovaný zdroj (jen github/gitlab https)")
        dest = os.path.join(MODULES_DIR, name)
        if os.path.exists(dest):
            raise RuntimeError("modul už je nainstalovaný")
        with _install_lock:
            cur = _install_jobs.get(mid)
            if cur and not cur.get("done", True):
                raise RuntimeError("instalace už běží")
            _install_jobs[mid] = {"phase": "starting", "percent": 2, "done": False,
                                  "ok": False, "error": None, "name": name}
        threading.Thread(target=_install_worker, args=(mid, url, name, dest),
                         daemon=True).start()
        return {"ok": True, "started": True, "name": name}

    @staticmethod
    def uninstall_module(name: str) -> dict:
        """Remove the module dir, its instances, every layout reference, and its
        catalog entry, then regenerate the files and restart the mirror."""
        if not _MODULE_NAME_RE.match(name or ""):
            raise ValueError("neplatné jméno modulu")
        import shutil
        dest = os.path.join(MODULES_DIR, name)
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        save_installed_modules(
            [m for m in load_installed_modules() if m.get("type") != name])
        store = load_store()
        removed = {i["id"] for i in store.get("instances", [])
                   if i.get("type") == name and i.get("id")}
        store["instances"] = [i for i in store.get("instances", [])
                              if i.get("type") != name]
        store["globalLayout"] = [g for g in store.get("globalLayout", [])
                                 if g.get("id") not in removed]
        for wins in store.get("windows", {}).values():
            for w in (wins or {}).values():
                w["layout"] = [e for e in w.get("layout", [])
                               if e.get("id") not in removed]
        save_store(store)
        generate_files(store)
        res = Supervisor._pm2_restart()
        return {"ok": res.get("ok", False), "removed": name,
                "output": res.get("output", "")}


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #
def make_handler(sup: Supervisor):
    class Handler(server.BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            return

        def _json(self, code: int, obj: dict) -> None:
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _query(self):
            q = urllib.parse.urlparse(self.path).query
            return {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):  # noqa: N802
            path = self.path.split("?", 1)[0]  # ignore query (e.g. ?k=cachebust)
            if path == "/healthz":
                self._json(200, sup.health())
            elif path == "/mode":
                self._json(200, {"mode": sup.mode})
            elif path == "/stream.mjpg":
                self._stream()
            elif path == "/dataset":
                try:
                    q = self._query()
                    self._json(200, {"name": q.get("name"),
                                     "photos": sup.list_photos(q.get("name", ""))})
                except ValueError as exc:
                    self._json(400, {"error": str(exc)})
            elif path == "/photo":
                self._photo()
            elif path == "/profiles":
                self._json(200, {"profiles": sup.list_profiles()})
            elif path == "/radar":
                self._json(200, sup.radar_status())
            elif path == "/modules":
                self._json(200, sup.list_modules())
            elif path == "/layout":
                self._json(200, sup.get_layout())
            elif path == "/store/catalog":
                self._json(200, sup.store_catalog())
            elif path == "/store/readme":
                q = self._query()
                self._json(200, sup.store_readme(q.get("id", ""), q.get("url", "")))
            elif path == "/store/install/status":
                self._json(200, sup.install_status(self._query().get("id", "")))
            else:
                self._json(404, {"error": "not found"})

        def do_PUT(self):  # noqa: N802
            if self.path.split("?", 1)[0] != "/layout":
                self._json(404, {"error": "not found"})
                return
            try:
                self._json(200, sup.save_layout(self._body()))
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                log.exception("save layout failed")
                self._json(500, {"error": str(exc)})

        def do_POST(self):  # noqa: N802
            path = self.path.split("?", 1)[0]
            try:
                if path == "/mode":
                    sup.apply_mode(self._body().get("mode"))
                    self._json(200, sup.health())
                elif path == "/capture":
                    body = self._body()
                    self._json(200, sup.capture_photo(
                        body.get("name", ""), body.get("file")))
                elif path == "/encode":
                    self._json(200, sup.encode_dataset())
                elif path == "/radar":
                    self._json(200, sup.set_radar(bool(self._body().get("active"))))
                elif path == "/layout/apply":
                    self._json(200, sup.apply_layout())
                elif path == "/store/install":
                    self._json(200, sup.install_module(self._body().get("id", "")))
                elif path == "/store/uninstall":
                    self._json(200, sup.uninstall_module(self._body().get("name", "")))
                else:
                    self._json(404, {"error": "not found"})
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except RuntimeError as exc:
                self._json(409, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                log.exception("POST %s failed", path)
                self._json(500, {"error": str(exc)})

        def do_DELETE(self):  # noqa: N802
            path = self.path.split("?", 1)[0]
            try:
                q = self._query()
                if path == "/dataset":
                    sup.delete_photo(q.get("name", ""), q.get("file", ""))
                    self._json(200, {"ok": True,
                                     "photos": sup.list_photos(q.get("name", ""))})
                elif path == "/profiles":
                    self._json(200, sup.remove_profile(q.get("name", "")))
                else:
                    self._json(404, {"error": "not found"})
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                log.exception("DELETE %s failed", path)
                self._json(500, {"error": str(exc)})

        def _photo(self):
            try:
                q = self._query()
                path = sup.photo_path(q.get("name", ""), q.get("file", ""))
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return
            if not os.path.isfile(path):
                self._json(404, {"error": "not found"})
                return
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)

        def _stream(self):
            self.send_response(200)
            self.send_header("Age", "0")
            self.send_header("Cache-Control", "no-cache, private")
            self.send_header("Pragma", "no-cache")
            self.send_header(
                "Content-Type",
                "multipart/x-mixed-replace; boundary=FRAME")
            self.end_headers()
            try:
                while True:
                    with sup.output.condition:
                        sup.output.condition.wait(timeout=5)
                        frame = sup.output.frame
                    if frame is None:
                        continue
                    self.wfile.write(b"--FRAME\r\n")
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(frame)))
                    self.end_headers()
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError):
                pass

    return Handler


class ThreadingHTTPServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser(description="Smart mirror camera supervisor")
    parser.add_argument("--host", default=BACKEND_HOST)
    parser.add_argument("--port", type=int, default=BACKEND_PORT)
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--encodings", default=DEFAULT_ENCODINGS)
    args = parser.parse_args()

    sup = Supervisor(args)
    # restore persisted mode on boot
    sup.apply_mode(sup.load_mode())

    # Bootstrap layout files from the draft store (pages.js + console-modules.js
    # are gitignored / per-Pi, so regenerate them on startup — survives a fresh
    # clone and any git checkout/pull that would otherwise wipe them).
    try:
        generate_files(load_store())
    except Exception as exc:  # noqa: BLE001
        log.warning("layout bootstrap failed: %s", exc)

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(sup))
    log.info("supervisor listening on http://%s:%d (mode=%s)",
             args.host, args.port, sup.mode)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        sup._pause_capture()
        sup._release_camera()
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
