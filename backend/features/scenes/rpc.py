"""Scenes RPC surface — MQTT only, **no HTTP at all**.

Every operation is an RPC endpoint under `smartmirror/scenes/rpc/…`: the
layout store (get/put), apply, and the catalog the editor needs. This feature
has no binary or streaming payload, so it needs no HTTP server and no port —
which is why this file is `rpc.py` and not `api.py` like the features that do
serve HTTP (camera, modules).

A scene apply announces itself on `smartmirror/scenes/applied` so the core
reloads without the app telling it separately, and hot-loading a newly placed
module into the running core is MQTT too (`smartmirror/core/hot-load`).
"""

import logging
import threading
import time

from shared import systemctl
from shared.mqtt_client import MqttClient

from features.modules import catalog

from . import codegen, mqtt as topics, store

log = logging.getLogger("scenes.rpc")


class InvalidLayout(Exception):
    """A layout that failed validation. `status` is what MqttClient.serve()
    puts in the error reply, so callers still see 400 as they did over HTTP."""

    status = 400


# How long to wait for the core to confirm a hot-load before falling back to
# a pm2 restart.
HOT_LOAD_TIMEOUT = 15.0

_client = None


def client() -> MqttClient:
    global _client
    if _client is None:
        _client = MqttClient("scenes_rpc").start()
    return _client


# --------------------------------------------------------------------------- #
# apply
# --------------------------------------------------------------------------- #
# Replies are correlated by moduleId through this registry, filled by one
# long-lived subscription. Subscribing per call would pile up a stale handler
# on every Apply, and each one would keep firing on later replies.
_hot_load_waiters: dict = {}
_hot_load_lock = threading.Lock()
_hot_load_subscribed = False


def _on_hot_load_result(_topic: str, payload: str) -> None:
    import json
    try:
        msg = json.loads(payload or "{}")
    except Exception:  # noqa: BLE001
        return
    mod_id = msg.get("moduleId")
    with _hot_load_lock:
        waiter = _hot_load_waiters.get(mod_id)
        if waiter is None:
            return                      # not ours, or already timed out
        waiter["ok"] = bool(msg.get("ok"))
        waiter["event"].set()


def _ensure_hot_load_subscription() -> None:
    global _hot_load_subscribed
    with _hot_load_lock:
        if _hot_load_subscribed:
            return
        _hot_load_subscribed = True
    client().subscribe(topics.HOT_LOAD_RESULT, _on_hot_load_result)


def _hot_load(instances: list) -> dict:
    """Ask the core to load each new instance at runtime, over MQTT.

    Publishes one `core/hot-load` per instance and waits for the core's
    `core/hot-load/result`. The core loads the node_helper and emits a socket
    event so the browser hot-loads the frontend JS/CSS too — no pm2 restart.

    A missing reply counts as a failure, which makes the caller fall back to a
    full restart exactly as the HTTP timeout used to. That direction matters:
    a silent success would leave the module never loaded.
    """
    by_type = catalog.by_type()
    targets = [(i.get("id"), (by_type.get(i.get("type", "")) or {})
                .get("module", i.get("type", "")), i)
               for i in instances if i.get("id")]
    if not targets:
        return {"ok": True, "failed": []}

    _ensure_hot_load_subscription()

    waiters = {}
    with _hot_load_lock:
        for mod_id, _name, _inst in targets:
            waiters[mod_id] = {"event": threading.Event(), "ok": False}
            _hot_load_waiters[mod_id] = waiters[mod_id]

    try:
        for mod_id, mod_name, inst in targets:
            client().publish(topics.HOT_LOAD, {
                "moduleName": mod_name,
                "moduleId": mod_id,
                "moduleConfig": codegen.module_config(inst.get("type", ""),
                                                      inst.get("values")),
            })

        deadline = time.monotonic() + HOT_LOAD_TIMEOUT
        failed = []
        for mod_id, mod_name, _inst in targets:
            remaining = deadline - time.monotonic()
            if remaining > 0 and waiters[mod_id]["event"].wait(remaining):
                if not waiters[mod_id]["ok"]:
                    log.warning("hot-load: core rejected %s", mod_name)
                    failed.append(mod_name)
            else:
                log.warning("hot-load: no reply from core for %s", mod_name)
                failed.append(mod_name)
        return {"ok": not failed, "failed": failed}
    finally:
        with _hot_load_lock:
            for mod_id in waiters:
                _hot_load_waiters.pop(mod_id, None)


def apply_layout() -> dict:
    """Generate pages.js + inject into config.js, then decide the cheapest way
    to make the mirror reflect it:

      * nothing new loaded   → the mirror just reloads pages.js
      * genuinely new module → hot-load it into the running core
      * hot-load failed      → full pm2 restart (last resort)
    """
    data = store.load()
    prev_ids = codegen.previous_module_ids()

    codegen.generate(data, catalog.by_type())

    new_ids = {i["id"] for i in data.get("instances") or [] if i.get("id")}
    added = new_ids - prev_ids

    if not added:
        result = {"ok": True, "restarted": False, "reload_needed": True}
    else:
        truly_new = [i for i in (data.get("instances") or [])
                     if i.get("id") in added]
        hot = _hot_load(truly_new)
        if hot["ok"]:
            result = {"ok": True, "restarted": False, "reload_needed": True}
        else:
            log.warning("apply: hot-load failed for %s — pm2 restart",
                        hot.get("failed"))
            res = systemctl.pm2_restart()
            result = {"ok": res["ok"], "restarted": True,
                      "reload_needed": False, "output": res.get("output", "")}

    # Tell the mirror (and any other listener) that the layout changed. This
    # is the piece that used to require the app to publish a reload itself.
    client().publish(topics.APPLIED, {
        "reload_needed": result.get("reload_needed", False),
        "restarted": result.get("restarted", False),
    })
    return result


# --------------------------------------------------------------------------- #
# RPC endpoints
# --------------------------------------------------------------------------- #
def mount() -> None:
    def op_layout_get(_req=None):
        return store.load()

    def op_layout_put(req):
        """Persist the draft only — does NOT touch pages.js/config.js (that is
        `apply`). Keeps the editor state across a refresh without changing
        what the mirror shows."""
        err = store.validate(req, catalog.by_type())
        if err:
            raise InvalidLayout(err)
        store.save(req)
        return {"ok": True}

    def op_layout_apply(_req=None):
        return apply_layout()

    def op_modules_get(_req=None):
        """Catalog + which ids are taken, for the scene editor.

        Both come from the DB now. They used to be scraped out of config.js
        with regexes, because that file was where instances lived; it is no
        longer involved.
        """
        instances = store.load().get("instances") or []
        by_type = catalog.by_type()
        loaded: dict = {}
        for inst in instances:
            cat = by_type.get(inst.get("type")) or {}
            name = cat.get("module") or inst.get("type")
            loaded.setdefault(name, []).append(inst["id"])
        ids = sorted(i["id"] for i in instances if i.get("id"))
        return {"catalog": catalog.placeable(), "registered_ids": ids,
                "loaded_by_module": loaded, "positions": store.MM_POSITIONS}

    c = client()
    c.serve(topics.RPC_LAYOUT_GET, op_layout_get)
    c.serve(topics.RPC_LAYOUT_PUT, _without_envelope(op_layout_put))
    c.serve(topics.RPC_LAYOUT_APPLY, op_layout_apply)
    c.serve(topics.RPC_MODULES_GET, op_modules_get)



def _without_envelope(fn):
    """Strip the RPC envelope keys before handing the payload to a handler
    that treats the whole message as its argument (the layout store is sent
    as the top-level object, not nested under a key)."""
    def wrapped(req: dict):
        return fn({k: v for k, v in req.items()
                   if k not in ("_rid", "_reply")})
    return wrapped
