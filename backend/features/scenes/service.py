"""Entrypoint for the scenes feature: `python3 -m features.scenes.service`.

Owns the scene editor's MQTT RPC surface and the pages.js / modules.js
codegen. Runs as its own systemd unit (`scenes`) so a crash here cannot take
the module store or the camera down with it.

There is no HTTP server and no port: every operation is MQTT (see rpc.py), so
the process just mounts its endpoints and sleeps on the MQTT loop.
"""

import argparse
import logging
import signal
import threading

from data import scene_windows as scene_windows_data
from shared import db, paths

from features.modules import catalog

from . import codegen, rpc, store

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s scenes: %(message)s")
log = logging.getLogger("scenes")

def bootstrap() -> None:
    """Make the on-disk MagicMirror files match the DB at startup.

    pages.js and the config.js managed block are per-Pi generated artefacts —
    a fresh clone or a `git checkout` wipes them, so they are regenerated here
    rather than only when the user presses Apply.
    """
    paths.ensure_var_dirs()
    db.init()
    catalog.seed_builtins()

    # Fresh DB: write the starter scene so the mirror is not blank before the
    # user opens the editor.
    if not scene_windows_data.any_exist():
        store.seed_if_empty()

    try:
        codegen.generate(store.load(), catalog.by_type())
    except Exception as exc:  # noqa: BLE001
        log.warning("layout bootstrap failed: %s", exc)


def main() -> int:
    argparse.ArgumentParser(description="Smart mirror scenes").parse_args()

    bootstrap()
    rpc.mount()
    log.info("scenes ready (MQTT only — no HTTP port)")

    # Nothing to serve: paho runs its own network thread, so park the main
    # thread until systemd stops the unit.
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_a: stop.set())
    stop.wait()
    log.info("shutting down")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
