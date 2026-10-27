"""Business logic for the camera feature, on demand.

Called by mqtt.py and http.py in response to a request; wraps the live
Supervisor instance (HW arbitration — mode machine, capture loop) plus
profiles.py and enrollment.py. Knows nothing about MQTT topics or HTTP
routes.

mount(sup) wires the module-level state this file holds (the live
Supervisor, the publisher callback) — called once by daemon.py at startup.
"""

import logging

from . import enrollment, profiles

log = logging.getLogger(__name__)

_sup = None
_publish = None


def mount(sup) -> None:
    """Wire the live Supervisor. Called once by daemon.py."""
    global _sup
    _sup = sup
    sup.on_state_change = _on_state_change


def set_publisher(fn) -> None:
    """mqtt.py hands in its `client().publish` so this module never imports
    an MQTT client directly."""
    global _publish
    _publish = fn


def _on_state_change(health: dict) -> None:
    if _publish is None:
        return
    from . import constants as topics
    _publish(topics.MODE, {"mode": health["mode"]}, retain=True)
    _publish(topics.STATE, health, retain=True)


# --------------------------------------------------------------------------- #
# camera operations — thin delegation to the live Supervisor
# --------------------------------------------------------------------------- #
def health() -> dict:
    return _sup.health()


def mode_get() -> dict:
    return {"mode": _sup.mode}


def mode_set(mode: str) -> dict:
    _sup.apply_mode(mode)
    return _sup.health()


def settings(payload: dict) -> dict:
    """One endpoint for every camera setting: resolution plus Picamera2
    image controls (brightness/contrast/exposure/white balance/gain/noise
    reduction). Callers send only the keys they want to change; unset keys
    keep their current value. Persisted to `camera_config` so it survives a
    `camera-supervisor` restart.
    """
    from . import supervisor as sup_mod
    from data import device_config

    if "width" in payload and "height" in payload:
        _sup.set_resolution(int(payload["width"]), int(payload["height"]))

    controls = {k: payload[k] for k in sup_mod.CAMERA_CONTROL_KEYS
               if k in payload}
    if controls:
        _sup.set_controls(controls)

    to_save = dict(controls)
    if "width" in payload and "height" in payload:
        to_save["resolution_width"] = _sup.width
        to_save["resolution_height"] = _sup.height
    if to_save:
        try:
            device_config.set_many("camera", to_save)
        except Exception:  # noqa: BLE001
            log.exception("failed to persist camera settings")

    return _sup.health()


def dataset_list(name: str) -> dict:
    return {"name": name, "photos": profiles.list_photos(name)}


def dataset_delete(name: str, file: str) -> dict:
    profiles.delete_photo(name, file)
    return {"photos": profiles.list_photos(name)}


def capture(name: str, file: str = None) -> dict:
    return enrollment.capture(_sup, name, file)


def encode(name: str = None) -> dict:
    return enrollment.encode(_sup, name)


def profiles_list() -> dict:
    result = {"profiles": profiles.list_all()}
    if _publish:
        from . import constants as topics
        _publish(topics.PROFILES, result, retain=True)
    return result


def profiles_delete(name: str) -> dict:
    result = profiles.remove(name)
    if _publish:
        from . import constants as topics
        _publish(topics.PROFILES, {"profiles": result["profiles"]}, retain=True)
    return result


# --------------------------------------------------------------------------- #
# radar unit control — lives here because the supervisor process is the one
# holding the systemctl sudoers rights, and a stopped radar daemon cannot
# start itself. The topics belong to the radar feature.
# --------------------------------------------------------------------------- #
def radar_status() -> dict:
    from shared import systemctl
    from features.radar import mqtt as radar_topics
    return {"active": systemctl.is_active(radar_topics.SERVICE_NAME),
           "available": systemctl.exists(radar_topics.SERVICE_NAME)}


def radar_get() -> dict:
    state = radar_status()
    if _publish:
        from features.radar import mqtt as radar_topics
        _publish(radar_topics.STATUS, state, retain=True)
    return state


def radar_set(active: bool) -> dict:
    from shared import systemctl
    from features.radar import mqtt as radar_topics
    systemctl.run("start" if active else "stop", radar_topics.SERVICE_NAME)
    state = radar_status()
    if _publish:
        _publish(radar_topics.STATUS, state, retain=True)
    return state


# --------------------------------------------------------------------------- #
# boot-time retained-topic primer
# --------------------------------------------------------------------------- #
def publish_initial_state() -> None:
    """Prime every retained topic at startup. Without this, `profiles` and
    `radar/status` only ever appear after someone calls their RPC — a
    freshly started broker would hold nothing retained for a subscriber to
    read, forcing the app back into polling."""
    try:
        profiles_list()
        radar_get()
    except Exception:  # noqa: BLE001
        log.exception("initial state publish failed")
