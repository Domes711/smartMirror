"""Business logic for the modules feature (the module store), on demand.

Called by mqtt.py and http.py in response to a request; calls catalog.py
(what is available) and install.py (clone/uninstall/readme) for the actual
work. Knows nothing about MQTT topics or HTTP routes.

The AI module builder is a separate feature now (features/ai_modules/).
"""

import logging
import threading
import time

from . import catalog, install
from . import constants

log = logging.getLogger(__name__)

_publish = None


def set_publisher(fn) -> None:
    """mqtt.py hands in its `client().publish` so this module never imports
    an MQTT client directly."""
    global _publish
    _publish = fn


def catalog_full() -> dict:
    return catalog.full_catalog()


def readme(mtype: str, url: str = "") -> dict:
    return install.readme(mtype, url)


def install_status(mtype: str) -> dict:
    return install.status(mtype)


def install_start(mtype: str) -> dict:
    result = install.install(mtype)
    if _publish:
        _publish(constants.INSTALL_STARTED, {"type": mtype})
    _watch_install(mtype)
    return result


def uninstall(mtype: str) -> dict:
    result = install.uninstall(mtype)
    if _publish:
        _publish(constants.UNINSTALLED,
                 {"type": mtype, "ok": result.get("ok")})
    return result


def _progress_topic(mtype: str) -> str:
    return f"{constants.INSTALL_PROGRESS}/{mtype}"


def _watch_install(mtype: str) -> None:
    """Stream install progress on MQTT until the job finishes.

    Replaces the app's old `/store/install/status` polling loop — progress
    is now pushed, retained, so a reconnecting app sees the current phase
    immediately.
    """

    def go():
        last = None
        for _ in range(600):           # up to ~20 min, matching the npm timeout
            time.sleep(2)
            st = install.status(mtype)
            snapshot = (st.get("phase"), st.get("percent"))
            if snapshot != last:
                last = snapshot
                if _publish:
                    _publish(_progress_topic(mtype), {"type": mtype, **st},
                             retain=True)
            if not st.get("done"):
                continue
            if _publish:
                if st.get("ok"):
                    _publish(constants.INSTALLED, {"type": mtype})
                else:
                    _publish(constants.INSTALL_FAILED,
                             {"type": mtype, "error": st.get("error")})
            return

    threading.Thread(target=go, daemon=True).start()
