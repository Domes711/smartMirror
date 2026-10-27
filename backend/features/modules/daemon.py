#!/usr/bin/env python3
"""modules daemon - entrypoint only: `python3 -m features.modules.daemon`.

Starts the MQTT connection (features.modules.mqtt) and the HTTP server for
catalog reads plus two static trees:

    /module-assets/<type>/<file>      store screenshots (var/module-assets)
    /module-installed/<name>/<file>   a live module's own files (demo.html,
                                       its node_helper.js, …) — the frontend's
                                       preview <iframe> for an *installed*
                                       module reads straight from
                                       MagicMirror/modules/, same tree the
                                       core itself loads. The AI builder's
                                       in-progress copy is a separate tree —
                                       see /module-draft on features/ai_modules/
                                       (:8004) — because a draft is not a
                                       module this feature knows about yet.

All business logic lives in service.py. The AI module builder (drafts, live
preview) is a separate feature — features/ai_modules/, on :8004.
"""

import logging

from shared import db, paths
from shared.http import Router, serve

from . import catalog, http as modules_http
from .mqtt import serve_all

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s modules: %(message)s")
log = logging.getLogger("modules")

HOST = "127.0.0.1"
PORT = 8003


def main() -> int:
    paths.ensure_var_dirs()
    db.init()
    catalog.seed_builtins()

    serve_all()

    router = Router()
    modules_http.mount(router)
    serve(router, HOST, PORT, static={
        "/module-assets": paths.MODULE_ASSETS_DIR,
        "/module-installed": paths.MM_MODULES_DIR,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
