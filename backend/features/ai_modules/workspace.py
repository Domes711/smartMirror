"""Working-copy file I/O for the ai_modules feature. Pure filesystem
operations — no DB, no decisions. Called by service.py once it already knows
(from the DB) what to do; never consulted as a source of truth itself.
"""

import io
import os
import re
import shutil
import unicodedata
import zipfile

from shared import paths

CLAUDE_MD = "CLAUDE.md"

_DIACRITICS_RE = re.compile(r"[̀-ͯ]")
_INVALID_CHARS_RE = re.compile(r"[^A-Za-z0-9-]+")


def path_for(name: str) -> str:
    return os.path.join(paths.AI_MODULES_WORKSPACE_DIR, name)


def installed_path(module_name: str) -> str:
    """Where an installed module's source lives: MagicMirror/modules/<name>/,
    or modules/default/<name>/ for the core's built-ins (clock, weather, …).
    Falls back to the modules root when neither exists."""
    for d in (os.path.join(paths.MM_MODULES_DIR, module_name),
              os.path.join(paths.MM_MODULES_DIR, "default", module_name)):
        if module_name and os.path.isdir(d):
            return d
    return paths.MM_MODULES_DIR


def write_files(name: str, files: dict) -> None:
    """Write a {filename: content} dict into the working copy, creating it
    if needed. Used by scaffold (new draft)."""
    d = path_for(name)
    os.makedirs(d, exist_ok=True)
    for fname, content in files.items():
        with open(os.path.join(d, fname), "w", encoding="utf-8") as f:
            f.write(content)


def write_claude_md(name: str, content: str) -> None:
    d = path_for(name)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, CLAUDE_MD), "w", encoding="utf-8") as f:
        f.write(content)


def copy_from_installed(name: str) -> None:
    """Copy a live module from MagicMirror/modules/<name>/ into the working
    copy, so it can be edited without touching the original until install."""
    src = os.path.join(paths.MM_MODULES_DIR, name)
    dest = path_for(name)
    shutil.copytree(src, dest, dirs_exist_ok=True)


def copy_to_installed(name: str, final_name: str) -> str:
    """Copy the working copy into MagicMirror/modules/<final_name>/,
    overwriting whatever is already there. Returns the destination path."""
    src = path_for(name)
    dest = os.path.join(paths.MM_MODULES_DIR, final_name)

    def ignore(_dir, names):
        return [n for n in names if n == "node_modules"]

    shutil.copytree(src, dest, ignore=ignore, dirs_exist_ok=True)
    return dest


def delete_working_copy(name: str) -> None:
    d = path_for(name)
    if os.path.isdir(d):
        shutil.rmtree(d)


def normalize_name(raw_name: str) -> str:
    """Strip spaces/diacritics from a user-typed name and ensure the
    `MMM-` prefix MagicMirror modules are conventionally named with."""
    stripped = unicodedata.normalize("NFKD", raw_name or "")
    stripped = _DIACRITICS_RE.sub("", stripped)
    stripped = stripped.strip().replace(" ", "-")
    stripped = _INVALID_CHARS_RE.sub("-", stripped).strip("-")
    if not stripped:
        raise ValueError("empty module name")
    if not stripped.upper().startswith("MMM-"):
        stripped = f"MMM-{stripped}"
    else:
        stripped = f"MMM-{stripped[4:]}"
    return stripped


def zip_working_copy(name: str) -> bytes:
    """Zip the entire working copy for the frontend to unpack and preview."""
    d = path_for(name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(d):
            for fname in files:
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, d)
                zf.write(full, rel)
    return buf.getvalue()
