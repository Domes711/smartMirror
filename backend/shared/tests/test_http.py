"""Shared HTTP layer: route matching, error mapping, static traversal guard."""

import json
import urllib.error
import urllib.request

import pytest

from shared.http import HttpError, Router, serve


def test_route_matching():
    r = Router()
    r.add("GET", "/layout", lambda q: {"ok": True})
    r.add("GET", "/photo/{name}", lambda q: {"name": q.params["name"]})
    assert r.match("GET", "/layout")[0] is not None
    assert r.match("GET", "/layout/")[0] is not None     # trailing slash
    assert r.match("POST", "/layout")[0] is None         # wrong method
    assert r.match("GET", "/layouts")[0] is None         # no prefix match
    fn, params = r.match("GET", "/photo/tata")
    assert params == {"name": "tata"}


def test_a_path_param_does_not_span_segments():
    r = Router()
    r.add("GET", "/x/{a}", lambda q: None)
    assert r.match("GET", "/x/one/two")[0] is None


@pytest.fixture
def server(tmp_path):
    """A live router on an ephemeral port, plus a static dir."""
    static_dir = tmp_path / "assets"
    static_dir.mkdir()
    (static_dir / "a.png").write_bytes(b"\x89PNG")
    (tmp_path / "secret.txt").write_text("nope")

    r = Router()
    r.add("GET", "/ok", lambda q: {"hello": "svete"})
    r.add("GET", "/q", lambda q: {"got": q.query.get("v")})
    r.add("POST", "/echo", lambda q: {"body": q.body()})
    r.add("GET", "/boom-value", _raise(ValueError("spatne")))
    r.add("GET", "/boom-runtime", _raise(RuntimeError("konflikt")))
    r.add("GET", "/boom-http", _raise(HttpError(404, "nenalezeno")))
    r.add("GET", "/boom-other", _raise(KeyError("surprise")))

    httpd = serve(r, "127.0.0.1", 0, static={"/assets": str(static_dir)},
                  background=True)
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def _raise(exc):
    def fn(_q):
        raise exc
    return fn


def _get(base, path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    rq = urllib.request.Request(base + path, data=data, method=method,
                                headers={"Content-Type": "application/json"}
                                if data else {})
    try:
        with urllib.request.urlopen(rq, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_json_response(server):
    status, body = _get(server, "/ok")
    assert status == 200
    assert json.loads(body) == {"hello": "svete"}


def test_query_and_body_parsing(server):
    assert json.loads(_get(server, "/q?v=42")[1]) == {"got": "42"}
    assert json.loads(_get(server, "/echo", "POST", {"a": 1})[1]) == {
        "body": {"a": 1}}


@pytest.mark.parametrize("path, code, msg", [
    ("/boom-value", 400, "spatne"),
    ("/boom-runtime", 409, "konflikt"),
    ("/boom-http", 404, "nenalezeno"),
    ("/boom-other", 500, None),
    ("/nothing-here", 404, "not found"),
])
def test_exception_to_status_mapping(server, path, code, msg):
    """Routes raise domain exceptions; the layer maps them so no handler has
    to build an error response by hand."""
    status, body = _get(server, path)
    assert status == code
    if msg:
        assert msg in json.loads(body)["error"]


def test_static_files_are_served(server):
    status, body = _get(server, "/assets/a.png")
    assert status == 200 and body == b"\x89PNG"


@pytest.mark.parametrize("path", [
    "/assets/../secret.txt",
    "/assets/%2e%2e/secret.txt",
    "/assets/../../etc/passwd",
])
def test_static_rejects_traversal(server, path):
    status, _ = _get(server, path)
    assert status in (403, 404)
