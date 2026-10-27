"""Face enrollment: capture a training photo from the live stream.

Lives in the camera feature (not a separate one) because it is inseparable
from the supervisor's state: it needs the camera lock and the last clean
frame the capture loop snapshotted in `learn` mode.
"""

import logging
import os

from . import profiles

log = logging.getLogger("camera.enrollment")


def capture(sup, name: str, file: str = None) -> dict:
    """Save the current clean frame into dataset/<name>/.

    Without `file`, appends as the next N.jpg; with `file`, overwrites that
    exact filename (used to retake one specific photo).
    """
    import cv2
    if sup.overlay != "learn" or sup.last_raw is None:
        raise RuntimeError("not in learn mode / no frame yet")

    d = profiles.person_dir(name)
    os.makedirs(d, exist_ok=True)
    fname = profiles._check_file(file) if file else profiles.next_filename(name)

    # Match the dataset's existing convention: the camera array is RGB, the
    # stored files (and what the encoder expects) are BGR.
    cv2.imwrite(os.path.join(d, fname),
                cv2.cvtColor(sup.last_raw, cv2.COLOR_RGB2BGR))
    profiles.register_photo(name, fname)
    log.info("captured %s/%s", name, fname)
    return {"file": fname, "total": len(profiles.list_photos(name))}


def encode(sup, name: str = None) -> dict:
    """Retrain the encodings, then drop the supervisor's cached copy so the
    next frame picks up the new face."""
    result = profiles.encode(name)
    sup.drop_encoding_cache()
    return result
