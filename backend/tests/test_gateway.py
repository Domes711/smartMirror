"""Gateway: the edge route table and its failure behaviour."""

import json
import threading
import urllib.error
import urllib.request

import pytest

import gateway
from shared.http import Router, serve


# Scenes is MQTT-only: it has no port and therefore no gateway route.
@pytest.mark.parametrize("path, port", [
    ("/healthz", 8001), ("/stream.mjpg", 8001), ("/photo?name=a", 8001),
    ("/dataset", 8001), ("/profiles", 8001), ("/radar", 8001),
    ("/mode", 8001), ("/resolution", 8001), ("/capture", 8001),
    ("/encode", 8001),
    ("/store/catalog", 8003), ("/store/install/status", 8003),
    ("/module-assets/x/y.png", 8003),
    ("/module-installed/MMM-X/demo.html", 8003),
    ("/module-draft/MMM-X/demo.html", 8004),
    ("/mic/recording", 8005),
])
def test_routes_land_on_the_right_feature(path, port):
    target = gateway.route_for(path.split("?")[0])
    assert target is not None, path
    assert target[1] == port


@pytest.mark.parametrize("path", [
    "/", "/nope", "/storex",
    # Scenes used to live here before it moved to MQTT-only; the gateway must
    # not route them any more.
    "/layout", "/layout/apply", "/modules",
    # The AI builder's old HTTP surface (chat, chat/stream, draft/session
    # CRUD) was removed when ai_modules became MQTT-only — the frontend still
    # calls these paths, but the gateway must not route them to a port that
    # answers something else (see gateway.py's module docstring).
    "/api/modules/list", "/api/modules/chat", "/api/modules/chat/stream",
])
def test_unrouted_paths_are_rejected(path):
    assert gateway.route_for(path) is None


def test_longest_prefix_wins():
    """/module-draft must not be swallowed by a shorter /module- route."""
    assert gateway.route_for("/module-draft/MMM-X/demo.html")[1] == 8004
    assert gateway.route_for("/module-installed/MMM-X/demo.html")[1] == 8003


@pytest.fixture
def edge(monkeypatch):
    """A real gateway in front of a real (tiny) upstream."""
    r = Router()
    r.add("GET", "/store", lambda q: {"from": "upstream"})
    r.add("POST", "/store/install", lambda q: {"body": q.body()})
    up = serve(r, "127.0.0.1", 0, background=True)
    up_port = up.server_address[1]

    monkeypatch.setattr(gateway, "MODULES", ("127.0.0.1", up_port))
    monkeypatch.setattr(gateway, "CAMERA", ("127.0.0.1", 1))   # nothing there
    monkeypatch.setattr(gateway, "ROUTES", sorted(
        [("/store", ("127.0.0.1", up_port)), ("/healthz", ("127.0.0.1", 1))],
        key=lambda x: -len(x[0])))

    gw = gateway.ThreadingHTTPServer(("127.0.0.1", 0), gateway.Handler)
    threading.Thread(target=gw.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{gw.server_address[1]}"
    gw.shutdown()
    up.shutdown()


def _req(base, path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    rq = urllib.request.Request(base + path, data=data, method=method,
                                headers={"Content-Type": "application/json"}
                                if data else {})
    try:
        with urllib.request.urlopen(rq, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_get_is_relayed(edge):
    status, body = _req(edge, "/store")
    assert status == 200 and json.loads(body) == {"from": "upstream"}


def test_request_body_is_relayed(edge):
    status, body = _req(edge, "/store/install", "POST", {"x": 1})
    assert status == 200 and json.loads(body)["body"] == {"x": 1}


def test_a_down_feature_is_502_not_a_hang(edge):
    """One feature crashing must surface as a clean error, not take the
    whole origin down — that is why they are separate units."""
    status, body = _req(edge, "/healthz")
    assert status == 502 and "upstream" in json.loads(body)["error"]


def test_unrouted_path_is_404(edge):
    assert _req(edge, "/nothing")[0] == 404
