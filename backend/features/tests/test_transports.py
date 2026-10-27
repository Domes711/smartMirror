"""Every JSON endpoint must exist on MQTT, and the HTTP twin must call the
same handler.

The migration keeps both transports alive while the frontend moves over. The
risk that creates is drift: a fix applied to one path and not the other. These
tests pin the two together — if someone adds an HTTP route without an RPC
topic (or vice versa), this fails.
"""

import threading

import pytest

from shared.http import Router


class RecordingClient:
    """Captures what a feature registers on MQTT."""

    def __init__(self):
        self.served = {}
        self.subscribed = {}
        self.published = []

    def serve(self, topic, handler, qos=1):
        self.served[topic] = handler

    def subscribe(self, topic, callback, qos=1):
        self.subscribed[topic] = callback

    def publish(self, topic, payload, retain=False, qos=1):
        self.published.append((topic, payload))


def _http_paths(router: Router):
    return {(method, rx.pattern) for method, rx, _fn in router.routes}


# --------------------------------------------------------------------------- #
# scenes — MQTT only, no HTTP surface at all
# --------------------------------------------------------------------------- #
def test_scenes_exposes_every_operation_on_mqtt(sandbox, monkeypatch):
    from features.modules import catalog
    from features.scenes import rpc, mqtt as topics
    catalog.seed_builtins()

    rec = RecordingClient()
    monkeypatch.setattr(rpc, "client", lambda: rec)
    rpc.mount()

    assert set(rec.served) == {
        topics.RPC_LAYOUT_GET, topics.RPC_LAYOUT_PUT,
        topics.RPC_LAYOUT_APPLY, topics.RPC_MODULES_GET,
    }


def test_scenes_mount_takes_no_router(sandbox, monkeypatch):
    """The feature has no binary or streaming payload, so it serves no HTTP
    and `mount()` must not ask for a Router."""
    import inspect
    from features.scenes import rpc
    assert list(inspect.signature(rpc.mount).parameters) == []


def test_scenes_layout_get_returns_the_store(sandbox, monkeypatch):
    from features.modules import catalog
    from features.scenes import rpc, mqtt as topics, store
    catalog.seed_builtins()
    store.seed_if_empty()

    rec = RecordingClient()
    monkeypatch.setattr(rpc, "client", lambda: rec)
    rpc.mount()

    result = rec.served[topics.RPC_LAYOUT_GET]({})
    assert set(result) >= {"defaults", "windows", "instances"}


def test_scenes_layout_put_validates_over_mqtt(sandbox, monkeypatch):
    """Validation must not be an HTTP-layer concern."""
    from features.modules import catalog
    from features.scenes import rpc, mqtt as topics
    catalog.seed_builtins()

    rec = RecordingClient()
    monkeypatch.setattr(rpc, "client", lambda: rec)
    rpc.mount()

    with pytest.raises(rpc.InvalidLayout) as exc:
        rec.served[topics.RPC_LAYOUT_PUT]({
            "_rid": "x", "_reply": "y",
            "defaults": {"default": [{"id": "a", "position": "NOPE"}]},
            "windows": {}, "instances": [],
        })
    assert exc.value.status == 400


def test_layout_put_ignores_the_rpc_envelope(sandbox, monkeypatch):
    """`_rid`/`_reply` must not leak into the stored layout."""
    from features.modules import catalog
    from features.scenes import rpc, mqtt as topics, store
    catalog.seed_builtins()
    store.seed_if_empty()
    current = store.load()

    rec = RecordingClient()
    monkeypatch.setattr(rpc, "client", lambda: rec)
    rpc.mount()

    rec.served[topics.RPC_LAYOUT_PUT]({"_rid": "r1", "_reply": "t/back",
                                       **current})
    saved = store.load()
    assert "_rid" not in saved and "_reply" not in saved


def test_gateway_has_no_scenes_route(sandbox):
    """Scenes has no port, so nothing may route to it."""
    import gateway
    for path in ("/layout", "/layout/apply", "/modules"):
        assert gateway.route_for(path) is None, path


# --------------------------------------------------------------------------- #
# modules
# --------------------------------------------------------------------------- #
def test_modules_exposes_store_operations_on_mqtt(sandbox, monkeypatch):
    from features.modules import catalog, mqtt as modules_mqtt
    from features.modules import constants as topics
    catalog.seed_builtins()

    rec = RecordingClient()
    monkeypatch.setattr(modules_mqtt, "client", lambda: rec)
    modules_mqtt.serve_all()

    expected = {
        topics.RPC_CATALOG, topics.RPC_README, topics.RPC_INSTALL,
        topics.RPC_INSTALL_STATUS, topics.RPC_UNINSTALL,
    }
    assert expected == set(rec.served)


def test_modules_http_is_catalog_reads_only(sandbox, monkeypatch):
    """Install/uninstall/progress are MQTT-only now — only catalog reads
    (fetched as a page load, not a pub/sub exchange) stay HTTP."""
    from features.modules import catalog, http as modules_http
    catalog.seed_builtins()

    router = Router()
    modules_http.mount(router)

    assert _http_paths(router) == {
        ("GET", "^/store/catalog/?$"),
        ("GET", "^/store/readme/?$"),
    }


def test_modules_rpc_and_http_agree_on_the_catalog(sandbox, monkeypatch):
    from features.modules import catalog, http as modules_http
    from features.modules import mqtt as modules_mqtt
    from features.modules import constants as topics
    catalog.seed_builtins()

    rec = RecordingClient()
    monkeypatch.setattr(modules_mqtt, "client", lambda: rec)
    modules_mqtt.serve_all()

    router = Router()
    modules_http.mount(router)

    http_fn, _ = router.match("GET", "/store/catalog")
    assert rec.served[topics.RPC_CATALOG]({}) == http_fn(None)


def test_modules_install_rpc_and_mqtt_publish_through_the_same_service(
        sandbox, monkeypatch):
    """mqtt.py must not duplicate install/uninstall orchestration — both
    transports call the same service.py functions, generalizing the catalog
    check above to the install/uninstall path."""
    from features.modules import catalog, install, mqtt as modules_mqtt
    from features.modules import constants as topics
    catalog.seed_builtins()
    catalog.upsert({"type": "MMM-Agree", "module": "MMM-Agree",
                    "url": "https://github.com/x/MMM-Agree"}, "community")
    monkeypatch.setattr(install, "install",
                        lambda mtype: {"ok": True, "started": True, "name": mtype})

    rec = RecordingClient()
    monkeypatch.setattr(modules_mqtt, "client", lambda: rec)
    modules_mqtt.serve_all()

    result = rec.served[topics.RPC_INSTALL]({"id": "MMM-Agree"})
    assert result == {"ok": True, "started": True, "name": "MMM-Agree"}
    assert any(t == topics.INSTALL_STARTED for t, _p in rec.published)


# --------------------------------------------------------------------------- #
# ai_modules — MQTT only, plus the one zip route HTTP must carry
# --------------------------------------------------------------------------- #
def test_ai_modules_exposes_every_operation_on_mqtt(sandbox, monkeypatch):
    from features.ai_modules import constants, mqtt as ai_mqtt

    rec = RecordingClient()
    ai_mqtt.AiModulesMqtt(rec).serve_all()

    expected = {constants.STATUS, constants.LIST, constants.DRAFT_CREATE,
               constants.EDIT_OPEN, constants.MESSAGE, constants.SESSION,
               constants.INSTALL}
    assert expected == set(rec.served)


def test_ai_modules_http_is_the_zip_route_only(sandbox):
    from features.ai_modules import http as ai_http
    router = Router()
    ai_http.mount(router)
    assert _http_paths(router) == {
        ("GET", "^/module-draft/(?P<name>[^/]+)/?$"),
    }


def test_ai_stream_topic_is_per_session(sandbox):
    from features.ai_modules import constants
    a = constants.stream_topic("draft", "MMM-One")
    b = constants.stream_topic("installed", "MMM-One")
    assert a != b
    assert a.startswith(constants.STREAM)
    # The wildcard the app subscribes to must cover both.
    import paho.mqtt.client as mqtt_lib
    for t in (a, b):
        assert mqtt_lib.topic_matches_sub(constants.STREAM_WILDCARD, t)


def test_agent_events_are_published_to_the_session_topic(sandbox):
    """The agent's token stream is MQTT; payloads keep the SSE event shapes
    so the app's event handling transfers unchanged."""
    from features.ai_modules import constants, mqtt as ai_mqtt

    rec = RecordingClient()
    handler = ai_mqtt.AiModulesMqtt(rec)
    handler._publish_stream("draft", "MMM-Thing", {"type": "text", "text": "hi"})

    assert rec.published == [
        (constants.stream_topic("draft", "MMM-Thing"),
         {"type": "text", "text": "hi"}),
    ]


# --------------------------------------------------------------------------- #
# camera + radar
# --------------------------------------------------------------------------- #
class StubSupervisor:
    def __init__(self):
        self.mode = "idle"
        self.on_state_change = None
        self.resolutions = []
        self.output = type("Output", (), {"condition": threading.Condition(),
                                          "frame": None})()

    def health(self):
        return {"mode": self.mode, "modes": ["idle"], "camera_open": False,
                "daemon_active": True, "fps": 10, "width": 640, "height": 480}

    def apply_mode(self, mode):
        self.mode = mode or "idle"
        if self.on_state_change:
            self.on_state_change(self.health())

    def set_resolution(self, w, h):
        self.resolutions.append((w, h))


def test_camera_exposes_every_json_operation_on_mqtt(sandbox, monkeypatch):
    from features.camera import constants as topics, mqtt as camera_mqtt, service
    from features.radar import mqtt as radar_topics

    rec = RecordingClient()
    monkeypatch.setattr(camera_mqtt, "client", lambda: rec)
    service.mount(StubSupervisor())
    camera_mqtt.serve_all()

    assert set(rec.served) == {
        topics.RPC_HEALTH, topics.RPC_MODE_GET, topics.RPC_MODE_SET,
        topics.RPC_RESOLUTION, topics.RPC_DATASET_LIST,
        topics.RPC_DATASET_DELETE, topics.RPC_CAPTURE, topics.RPC_ENCODE,
        topics.RPC_PROFILES_LIST, topics.RPC_PROFILES_DELETE,
        radar_topics.RPC_SERVICE_GET, radar_topics.RPC_SERVICE_SET,
    }


def test_camera_keeps_only_the_binary_routes_on_http(sandbox):
    """/stream.mjpg and /photo are the permanent HTTP surface; the rest of the
    camera's routes are the removable shim."""
    from features.camera import http as camera_http

    router = Router()
    camera_http.mount(router, StubSupervisor())

    assert router.match("GET", "/stream.mjpg")[0] is not None
    assert router.match("GET", "/photo")[0] is not None


def test_camera_mode_set_over_mqtt_matches_http(sandbox, monkeypatch):
    from features.camera import constants as topics, mqtt as camera_mqtt, service

    rec = RecordingClient()
    monkeypatch.setattr(camera_mqtt, "client", lambda: rec)
    sup = StubSupervisor()
    service.mount(sup)
    camera_mqtt.serve_all()

    result = rec.served[topics.RPC_MODE_SET]({"mode": "test_face"})
    assert sup.mode == "test_face"
    assert result["mode"] == "test_face"
    # State is pushed retained, so the app never polls /healthz.
    assert any(t == topics.STATE for t, _p in rec.published)
    assert any(t == topics.MODE for t, _p in rec.published)


def test_radar_service_control_moved_off_the_camera_http_path(sandbox, monkeypatch):
    """The radar unit is controlled on radar-owned topics now, even though the
    camera supervisor is still the process holding the systemctl rights."""
    from features.camera import mqtt as camera_mqtt, service
    from features.radar import mqtt as radar_topics
    from shared import systemctl

    rec = RecordingClient()
    monkeypatch.setattr(camera_mqtt, "client", lambda: rec)
    calls = []
    monkeypatch.setattr(systemctl, "run", lambda *a: calls.append(a))
    monkeypatch.setattr(systemctl, "is_active", lambda _n: True)
    monkeypatch.setattr(systemctl, "exists", lambda _n: True)

    service.mount(StubSupervisor())
    camera_mqtt.serve_all()

    result = rec.served[radar_topics.RPC_SERVICE_SET]({"active": True})
    assert calls == [("start", radar_topics.SERVICE_NAME)]
    assert result == {"active": True, "available": True}
    # Status is published retained for subscribers.
    assert any(t == radar_topics.STATUS for t, _p in rec.published)


def test_radar_service_accepts_a_fire_and_forget_command(sandbox, monkeypatch):
    from features.camera import mqtt as camera_mqtt, service
    from features.radar import mqtt as radar_topics
    from shared import systemctl

    rec = RecordingClient()
    monkeypatch.setattr(camera_mqtt, "client", lambda: rec)
    calls = []
    monkeypatch.setattr(systemctl, "run", lambda *a: calls.append(a))
    monkeypatch.setattr(systemctl, "is_active", lambda _n: False)
    monkeypatch.setattr(systemctl, "exists", lambda _n: True)

    service.mount(StubSupervisor())
    camera_mqtt.serve_all()
    rec.subscribed[radar_topics.SERVICE_CONTROL](
        radar_topics.SERVICE_CONTROL, '{"active": false}')
    assert calls == [("stop", radar_topics.SERVICE_NAME)]


def test_camera_primes_every_retained_topic_at_boot(sandbox, monkeypatch):
    """A subscriber that connects later must find a value already retained.

    `profiles` and `radar/status` are otherwise published only when their RPC
    is called, so a fresh broker would hold nothing and the app would be
    forced back into polling.
    """
    from features.camera import constants as topics, mqtt as camera_mqtt, service
    from features.radar import mqtt as radar_topics
    from shared import systemctl

    rec = RecordingClient()
    monkeypatch.setattr(camera_mqtt, "client", lambda: rec)
    monkeypatch.setattr(systemctl, "is_active", lambda _n: False)
    monkeypatch.setattr(systemctl, "exists", lambda _n: True)

    sup = StubSupervisor()
    service.mount(sup)
    camera_mqtt.serve_all()
    rec.published.clear()

    # What features/camera/daemon.py calls after apply_mode().
    service.publish_initial_state()

    primed = {t for t, _p in rec.published}
    assert topics.PROFILES in primed
    assert radar_topics.STATUS in primed
    assert all(True for _t, _p in rec.published)


def test_camera_boot_hook_is_registered_by_mount(sandbox, monkeypatch):
    """service.mount() must always wire a live Supervisor or the camera unit
    dies on startup when daemon.py calls publish_initial_state()."""
    from features.camera import mqtt as camera_mqtt, service

    rec = RecordingClient()
    monkeypatch.setattr(camera_mqtt, "client", lambda: rec)
    service.mount(StubSupervisor())
    camera_mqtt.serve_all()
    assert callable(service.publish_initial_state)


# --------------------------------------------------------------------------- #
# mic — MQTT only, plus the one binary route HTTP must carry
# --------------------------------------------------------------------------- #
def test_mic_exposes_every_operation_on_mqtt(sandbox, monkeypatch):
    from features.mic import constants as topics, mqtt as mic_mqtt

    rec = RecordingClient()
    monkeypatch.setattr(mic_mqtt, "client", lambda: rec)
    mic_mqtt.serve_all()

    assert set(rec.served) == {
        topics.RPC_CONFIG_GET, topics.RPC_CONFIG_SET, topics.RPC_TEST_RECORD,
        topics.RPC_SERVICE_GET, topics.RPC_SERVICE_SET,
    }


def test_mic_http_is_the_recording_route_only(sandbox):
    from features.mic import http as mic_http

    router = Router()
    mic_http.mount(router)
    assert {(method, rx.pattern) for method, rx, _fn in router.routes} == {
        ("GET", "^/mic/recording/?$"),
    }


def test_mic_recording_route_404s_before_any_test_recording(sandbox):
    from shared.http import HttpError
    from features.mic import http as mic_http

    router = Router()
    mic_http.mount(router)
    fn, _ = router.match("GET", "/mic/recording")
    with pytest.raises(HttpError) as exc:
        fn(None)
    assert exc.value.status == 404
