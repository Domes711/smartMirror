"""Business logic for the mic feature, on demand.

Called by mqtt.py in response to a request; calls config.py for settings and
shared.systemctl for the two Wyoming units. Knows nothing about MQTT topics.

Test recording is the one piece of exclusive-hardware arbitration this
feature needs: the satellite holds the USB mic open continuously (its own
`arecord` subprocess via `--mic-command`), so a one-off test recording must
stop it first, record, then start it again — same shape as the camera
supervisor stopping `camera-recognition` before a test/learn capture, just
without a dedicated supervisor module since there is no persistent capture
loop or mode machine here to justify one.
"""

import logging
import os
import re
import subprocess
import time
import uuid

from shared import paths, systemctl

from . import config
from .constants import ALSA_MIC_CONTROL, SERVICE_NAME

log = logging.getLogger(__name__)

MAX_TEST_SECONDS = 30
RECORDING_FILE = "last.wav"
SATELLITE_STOP_WAIT_S = 1.0   # let arecord release the ALSA device

# Changing any of these three means the live wyoming-satellite.service's
# ExecStart (built from this template at setup.sh/apply time) no longer
# matches what is actually running — see _apply_satellite_unit().
_UNIT_AFFECTING_KEYS = ("device", "satellite_name", "wake_word")

APPLY_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "apply-satellite-unit.sh")


# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #
def config_get(profile: str = "default") -> dict:
    return config.load(profile)


def config_set(values: dict, profile: str = "default") -> dict:
    cfg = config.load(profile)
    unknown = set(values) - set(config.KEYS)
    if unknown:
        raise ValueError(f"unknown mic config key(s): {', '.join(sorted(unknown))}")
    config.save(values, profile=profile)
    cfg = config.load(profile)
    if "input_gain" in values:
        _apply_input_gain(cfg["device"], cfg["input_gain"])
    if any(k in values for k in _UNIT_AFFECTING_KEYS):
        _apply_satellite_unit(cfg)
    return cfg


_CARD_RE = re.compile(r"CARD=([^,]+)")


def _mixer_device(pcm_device: str) -> str:
    """`amixer -D` wants the *mixer* control device (`hw:CARD=X`), not the
    PCM stream device (`plughw:CARD=X,DEV=0`) `arecord`/the satellite use —
    they look alike but are not interchangeable: `amixer -D
    plughw:CARD=X,DEV=0` fails with "Invalid CTL" even though the same
    string is exactly what `arecord -D` wants. Extract the card name and
    rebuild the `hw:CARD=` form amixer expects. Falls back to the device
    string unchanged if it is not a `CARD=`-style name (e.g. plain
    `"default"`) — amixer handles that case itself.
    """
    m = _CARD_RE.search(pcm_device or "")
    return f"hw:CARD={m.group(1)}" if m else pcm_device


def _apply_input_gain(device: str, percent: int) -> None:
    """Best-effort `amixer` call — a config write must not fail just because
    the mixer control name differs on this card."""
    mixer_device = _mixer_device(device)
    try:
        res = subprocess.run(
            ["amixer", "-D", mixer_device, "sset", ALSA_MIC_CONTROL, f"{percent}%"],
            check=False, capture_output=True, text=True, timeout=10,
            stdin=subprocess.DEVNULL)
        if res.returncode != 0:
            log.warning("amixer set %s on %s failed (rc=%d): %s",
                       ALSA_MIC_CONTROL, mixer_device, res.returncode,
                       (res.stderr or "").strip())
    except Exception as exc:  # noqa: BLE001
        log.warning("amixer set %s on %s failed: %s", ALSA_MIC_CONTROL,
                   mixer_device, exc)


def _apply_satellite_unit(cfg: dict) -> None:
    """Regenerate wyoming-satellite.service from the template + restart it
    (if it was running), so `device`/`satellite_name`/`wake_word` changes
    reach the live unit instead of only the DB. Best-effort — a config write
    must still succeed even if the sudoers rule or the satellite install is
    missing (e.g. in tests, or before setup.sh has run).
    """
    rc, out = systemctl.run_privileged_script(
        APPLY_SCRIPT, cfg["device"], cfg["satellite_name"], cfg["wake_word"])
    if rc != 0:
        log.warning("apply-satellite-unit.sh failed: %s", out)


# --------------------------------------------------------------------------- #
# satellite service control
# --------------------------------------------------------------------------- #
def service_status() -> dict:
    return {"active": systemctl.is_active(SERVICE_NAME),
           "available": systemctl.exists(SERVICE_NAME)}


def service_set(active: bool) -> dict:
    systemctl.run("start" if active else "stop", SERVICE_NAME)
    return service_status()


# --------------------------------------------------------------------------- #
# test recording
# --------------------------------------------------------------------------- #
def _recording_path() -> str:
    return os.path.join(paths.MIC_RECORDINGS_DIR, RECORDING_FILE)


def test_recording(seconds: float) -> dict:
    """Record `seconds` of audio from the configured ALSA device, releasing
    the satellite's hold on the mic first if it is running.

    Overwrites the previous test recording — this is a diagnostic tool, not
    a history, so there is exactly one file to fetch over HTTP.
    """
    seconds = float(seconds or 0)
    if not 0 < seconds <= MAX_TEST_SECONDS:
        raise ValueError(f"seconds must be between 0 and {MAX_TEST_SECONDS}")

    device = config.load()["device"]
    was_active = systemctl.is_active(SERVICE_NAME)
    if was_active:
        systemctl.run("stop", SERVICE_NAME)
        time.sleep(SATELLITE_STOP_WAIT_S)

    rec_id = uuid.uuid4().hex
    dest = _recording_path()
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        res = subprocess.run(
            ["arecord", "-D", device, "-d", str(int(round(seconds))),
             "-f", "cd", dest],
            check=False, capture_output=True, text=True,
            timeout=seconds + 10, stdin=subprocess.DEVNULL)
        if res.returncode != 0:
            raise RuntimeError("arecord failed: " + (res.stderr or "")[-400:])
    finally:
        if was_active:
            systemctl.run("start", SERVICE_NAME)

    return {"ok": True, "id": rec_id, "seconds": seconds}


def recording_path() -> str:
    """Path to the last test recording, for http.py to serve."""
    return _recording_path()
