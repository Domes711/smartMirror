"""Canonical filesystem locations, derived from this file's position in the repo.

Every feature imports paths from here instead of recomputing `../..` chains —
that was the single biggest source of breakage when files moved during the
refactor.
"""

import os

# backend/shared/paths.py -> backend/ -> repo root
SHARED_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SHARED_DIR)
REPO_ROOT = os.path.dirname(BACKEND_DIR)

FEATURES_DIR = os.path.join(BACKEND_DIR, "features")

CAMERA_DIR = os.path.join(FEATURES_DIR, "camera")
MODULES_FEATURE_DIR = os.path.join(FEATURES_DIR, "modules")

# Every path below is resolved from the environment on each access, via the
# module-level __getattr__. That matters because features import these as
# `from shared.paths import DATASET_DIR` — a value bound at import time
# would freeze whatever the env said when the first module loaded, which
# makes the paths untestable and silently wrong if a unit sets them late.
def _resolve(name: str):
    var = os.environ.get("MIRROR_VAR_DIR") or os.path.join(BACKEND_DIR, "var")
    mm = os.environ.get("MAGICMIRROR_DIR") or os.path.join(REPO_ROOT, "MagicMirror")
    table = {
        "VAR_DIR": var,
        "DB_PATH": os.environ.get("MIRROR_DB") or os.path.join(var, "smartmirror.db"),

        # camera
        "DATASET_DIR": os.environ.get("MIRROR_DATASET_DIR") or os.path.join(var, "dataset"),
        "ENCODINGS_PATH": os.environ.get("MIRROR_ENCODINGS") or os.path.join(var, "encoded_faces.pickle"),

        # modules (store assets live on disk; the DB only references them)
        "MODULE_ASSETS_DIR": os.environ.get("MIRROR_MODULE_ASSETS") or os.path.join(var, "module-assets"),

        # mic — test recordings, overwritten each time (no history kept)
        "MIC_RECORDINGS_DIR": os.environ.get("MIRROR_MIC_RECORDINGS") or os.path.join(var, "mic-recordings"),

        # ai_modules — deliberately inside the feature folder, not var/: see
        # docs/features/ai_modules.md. Holds one subdir per in-progress
        # working copy, deleted once install() applies it.
        "AI_MODULES_WORKSPACE_DIR": os.environ.get("MIRROR_AI_MODULES_WORKSPACE")
            or os.path.join(FEATURES_DIR, "ai_modules", "modules"),

        # MagicMirror
        "MAGICMIRROR_DIR": mm,
        "MM_MODULES_DIR": os.path.join(mm, "modules"),
        "PAGES_PATH": os.path.join(mm, "config", "pages.js"),
        # Generated module instances, require()d by js/utils.js. The DB is the
        # source of truth; this file is how the core reads it without needing
        # a SQLite driver of its own.
        "MODULES_JS_PATH": os.path.join(mm, "config", "modules.js"),
        "CONFIG_JS_PATH": os.path.join(mm, "config", "config.js"),

        "MM_BASE_URL": os.environ.get("MM_BASE_URL") or "http://127.0.0.1:8080",
        "PM2_APP": os.environ.get("PM2_APP") or "MagicMirror",
    }
    if name not in table:
        raise AttributeError(f"module 'shared.paths' has no attribute {name!r}")
    return table[name]


def __getattr__(name: str):
    return _resolve(name)


def ensure_var_dirs() -> None:
    """Create the runtime state dirs. Safe to call from every entrypoint."""
    for key in ("VAR_DIR", "DATASET_DIR", "MODULE_ASSETS_DIR",
                "AI_MODULES_WORKSPACE_DIR", "MIC_RECORDINGS_DIR"):
        os.makedirs(_resolve(key), exist_ok=True)
