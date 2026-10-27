"""HTTP entrypoint for the mic feature.

Everything else is MQTT-only (mqtt.py) — this exists only for what pub/sub
cannot carry: the test recording's WAV bytes.
"""

import os

from shared.http import HttpError, Router

from . import service


def mount(router: Router) -> None:

    @router.get("/mic/recording")
    def get_recording(req):
        path = service.recording_path()
        if not os.path.isfile(path):
            raise HttpError(404, "no test recording yet")
        with open(path, "rb") as f:
            req.handler.blob(f.read(), "audio/wav")
        return None
