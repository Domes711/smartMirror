"""HTTP entrypoint for the ai_modules feature.

Everything else is MQTT-only (mqtt.py) — this exists only for what pub/sub
cannot carry: a working copy zipped up for the frontend to unpack into its
own <iframe> preview.
"""

from shared.http import HttpError, Router
from features.ai_modules import workspace


def mount(router: Router) -> None:

    @router.get("/module-draft/{name}")
    def get_draft_zip(req):
        name = req.params.get("name") or ""
        if not name:
            raise HttpError(400, "missing module name")
        data = workspace.zip_working_copy(name)
        req.handler.blob(data, "application/zip")
        return None
