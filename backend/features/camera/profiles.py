"""Face profiles and their training photos.

A profile is a person the mirror knows. The row lives in the shared
`profiles` table (scenes reference it too); the photos are rows in
`camera_photos` pointing at files under `var/dataset/<name>/`.

Before the refactor a profile was implicit — "a directory under dataset/
that has at least one jpg". That meant deleting a person silently left their
scenes behind, and a profile could not exist before its first photo. Now the
row is the profile and the photos hang off it.

`encoded_faces.pickle` stays a file: it is a binary blob the
`face_recognition` library loads whole, read by one process.
"""

import logging
import os
import random
import re
import shutil
import subprocess
import sys

from data import camera_photos, profiles as profiles_data
from shared import db
from shared.paths import CAMERA_DIR
from shared import paths

log = logging.getLogger("camera.profiles")

DEFAULT_PROFILE = "default"

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
FILE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,60}\.(jpg|jpeg|png)$", re.IGNORECASE)

ENCODE_SCRIPT = os.path.join(CAMERA_DIR, "encode_faces.py")
_IMAGE_EXT = (".jpg", ".jpeg", ".png")


def _check_name(name: str) -> str:
    if not NAME_RE.match(name or ""):
        raise ValueError("invalid name")
    return name


def _check_file(file: str) -> str:
    if not FILE_RE.match(file or ""):
        raise ValueError("invalid file")
    return file


def person_dir(name: str) -> str:
    return os.path.join(paths.DATASET_DIR, _check_name(name))


# --------------------------------------------------------------------------- #
# profiles
# --------------------------------------------------------------------------- #
def ensure(name: str) -> None:
    from features.scenes.store import ensure_profile
    ensure_profile(_check_name(name))


def list_all() -> list:
    """Profiles with their photo count and one random sample photo.

    `count` is derived (COUNT over camera_photos), not stored — exactly as
    the old code derived it from `len(os.listdir(...))`.
    """
    db.init()
    _reconcile()
    counts = camera_photos.counts()
    out = []
    for row in profiles_data.list_all():
        files = camera_photos.files_for(row["name"])
        out.append({"name": row["name"], "count": counts.get(row["name"], 0),
                    "sample": random.choice(files) if files else None,
                    "is_default": row["is_default"]})
    return out


def remove(name: str) -> dict:
    """Delete the person's photos + dataset folder, then rebuild the
    encodings so the removed face is no longer recognized.

    The fallback profile cannot be removed — the mirror would have nothing to
    show for an unrecognized face. That is a rule, so it is checked here
    rather than in `data/`.
    """
    from features.scenes.store import remove_profile
    if profiles_data.is_default(name):
        raise ValueError("výchozího uživatele nelze odebrat")
    d = person_dir(name)
    if os.path.isdir(d):
        shutil.rmtree(d)
    # Cascade clears camera_photos and the profile's scenes along with it.
    remove_profile(name)
    log.info("removed profile %s", name)
    return {"removed": name, "encode": rebuild_encodings(),
            "profiles": list_all()}


def _reconcile() -> None:
    """Make the DB agree with the dataset directory.

    Photos can appear or vanish outside the API (someone scp's a folder onto
    the Pi, or restores a backup), so the listing self-heals instead of
    reporting counts that no longer match what the encoder will see.
    """
    if not os.path.isdir(paths.DATASET_DIR):
        return
    on_disk = {}
    for name in os.listdir(paths.DATASET_DIR):
        d = os.path.join(paths.DATASET_DIR, name)
        if not os.path.isdir(d) or not NAME_RE.match(name):
            continue
        on_disk[name] = {f for f in os.listdir(d)
                         if os.path.splitext(f)[1].lower() in _IMAGE_EXT}

    # Read the known set before opening the write transaction: reads inside
    # `db.tx()` would run on the same connection but outside its intent.
    known_by_profile = {name: set(camera_photos.files_for(name))
                        for name in on_disk}
    stale = [name for name in camera_photos.profiles_with_photos()
             if name not in on_disk]

    with db.tx() as conn:
        for name, files in on_disk.items():
            profiles_data.ensure(name, conn=conn)
            known = known_by_profile[name]
            for f in files - known:
                camera_photos.add(name, f, conn=conn)
            for f in known - files:
                camera_photos.delete(name, f, conn=conn)
        # Rows for a dataset dir that no longer exists at all.
        for name in stale:
            camera_photos.delete_all_for(name, conn=conn)


# --------------------------------------------------------------------------- #
# photos
# --------------------------------------------------------------------------- #
def list_photos(name: str) -> list:
    d = person_dir(name)
    if not os.path.isdir(d):
        return []
    files = [f for f in os.listdir(d)
             if os.path.splitext(f)[1].lower() in _IMAGE_EXT]
    # Numeric stems sort numerically (1.jpg, 2.jpg, …, 10.jpg), not as text.
    return sorted(files, key=lambda f: (
        int(os.path.splitext(f)[0]) if os.path.splitext(f)[0].isdigit() else 0, f))


def next_filename(name: str) -> str:
    nums = [int(os.path.splitext(f)[0]) for f in list_photos(name)
            if os.path.splitext(f)[0].isdigit()]
    return f"{(max(nums) + 1) if nums else 1}.jpg"


def register_photo(name: str, file: str) -> None:
    ensure(name)
    camera_photos.add(name, file)


def delete_photo(name: str, file: str) -> None:
    path = os.path.join(person_dir(name), _check_file(file))
    if os.path.isfile(path):
        os.remove(path)
        log.info("deleted %s/%s", name, file)
    camera_photos.delete(name, file)


def photo_path(name: str, file: str) -> str:
    return os.path.join(person_dir(name), _check_file(file))


# --------------------------------------------------------------------------- #
# encodings
# --------------------------------------------------------------------------- #
def encode(name: str = None) -> dict:
    """Retrain encoded_faces.pickle from the dataset.

    With `name`, only that profile is re-encoded and merged into the existing
    pickle — keeping enrollment bounded instead of re-encoding the whole
    dataset every time a profile is added (which grows unbounded on the Pi
    and made "Dokončit a natrénovat" look like it had hung).
    """
    os.makedirs(os.path.dirname(paths.ENCODINGS_PATH), exist_ok=True)
    cmd = [sys.executable, ENCODE_SCRIPT,
           "--dataset", paths.DATASET_DIR, "--output", paths.ENCODINGS_PATH]
    if name:
        cmd += ["--name", _check_name(name)]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=600,
                             cwd=CAMERA_DIR)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "output": str(exc), "error": str(exc)}
    out = (res.stdout or "") + (res.stderr or "")
    ok = res.returncode == 0
    result = {"ok": ok, "output": out[-4000:]}
    if not ok:
        # Surface the encoder's own message so the app's toast is meaningful.
        lines = [ln for ln in out.splitlines() if ln.strip()]
        result["error"] = lines[-1] if lines else "trénink selhal"
    return result


def rebuild_encodings() -> dict:
    """Re-run the encoder, or write an empty pickle when the dataset is empty
    (encode_faces.py errors out on an empty dataset)."""
    has_images = any(
        os.path.isdir(os.path.join(paths.DATASET_DIR, p)) and any(
            os.path.splitext(f)[1].lower() in _IMAGE_EXT
            for f in os.listdir(os.path.join(paths.DATASET_DIR, p)))
        for p in (os.listdir(paths.DATASET_DIR) if os.path.isdir(paths.DATASET_DIR) else []))
    if not has_images:
        import pickle
        os.makedirs(os.path.dirname(paths.ENCODINGS_PATH), exist_ok=True)
        with open(paths.ENCODINGS_PATH, "wb") as f:
            pickle.dump({"encodings": [], "names": []}, f)
        return {"ok": True, "output": "dataset empty — wrote empty encodings"}
    return encode()
