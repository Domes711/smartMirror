"""Minimal routed HTTP server shared by the features that still need HTTP.

The spec's goal is "zrušit proxy vrstvu, ne zrušit HTTP" — binary streams
(MJPEG, photos), static assets and the AI-builder SSE chat cannot sensibly
become MQTT request/reply. Those endpoints stay HTTP, but are now served
*directly* by the owning feature instead of being relayed through a Node
proxy.

This is deliberately stdlib-only (`http.server`): the features serve a handful
of routes each, and adding Flask/FastAPI to a Pi Zero-class device buys
nothing here. `Router` just removes the if/elif chain supervisor.py had grown.
"""

import json
import logging
import os
import re
import socketserver
import threading
import urllib.parse
from http import server

log = logging.getLogger("http")


class Request:
    """Parsed request handed to a route function."""

    def __init__(self, handler, params: dict):
        self.handler = handler
        self.params = params                      # path params
        parsed = urllib.parse.urlparse(handler.path)
        self.path = parsed.path
        self.query = {k: v[0] for k, v in
                      urllib.parse.parse_qs(parsed.query).items()}
        self.headers = handler.headers

    def body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if not length:
            return {}
        raw = self.handler.rfile.read(length)
        try:
            return json.loads(raw or b"{}")
        except Exception:  # noqa: BLE001
            return {}

    def raw_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.handler.rfile.read(length) if length else b""


class HttpError(Exception):
    """Raise from a route to return a specific status + message."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Router:
    """Register `(method, path pattern) -> fn(Request)`.

    Patterns use `{name}` for a path segment. A route returning a dict is sent
    as JSON; a route that writes to the handler itself returns `None`.
    """

    def __init__(self):
        self.routes = []   # (method, compiled regex, fn)

    def add(self, method: str, pattern: str, fn) -> None:
        rx = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)",
                                     pattern.rstrip("/")) + "/?$")
        self.routes.append((method.upper(), rx, fn))

    def get(self, p):
        return lambda fn: (self.add("GET", p, fn), fn)[1]

    def post(self, p):
        return lambda fn: (self.add("POST", p, fn), fn)[1]

    def put(self, p):
        return lambda fn: (self.add("PUT", p, fn), fn)[1]

    def delete(self, p):
        return lambda fn: (self.add("DELETE", p, fn), fn)[1]

    def match(self, method: str, path: str):
        for m, rx, fn in self.routes:
            if m != method:
                continue
            hit = rx.match(path.rstrip("/") or "/")
            if hit:
                return fn, hit.groupdict()
        return None, None

    def merge(self, other: "Router", prefix: str = "") -> None:
        """Mount another router's routes, optionally under a path prefix."""
        for m, rx, fn in other.routes:
            if not prefix:
                self.routes.append((m, rx, fn))
            else:
                # Re-derive the pattern source is not possible from the regex,
                # so routers that need a prefix must register with it directly.
                raise ValueError("prefix merge unsupported — register with prefix")


def make_handler(router: Router, static: dict = None):
    """Build a BaseHTTPRequestHandler class for `router`.

    `static` maps a URL prefix -> directory served as files (store assets,
    AI-builder module previews).
    """
    static = static or {}

    class Handler(server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # quiet — journald already timestamps
            return

        # ---- response helpers ------------------------------------------ #
        def json(self, code: int, obj) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def blob(self, data: bytes, content_type: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)

        # ---- dispatch ---------------------------------------------------- #
        def _serve_static(self, path: str) -> bool:
            for prefix, root in static.items():
                if not path.startswith(prefix):
                    continue
                rel = urllib.parse.unquote(path[len(prefix):].lstrip("/"))
                # Reject traversal before touching the filesystem.
                full = os.path.normpath(os.path.join(root, rel))
                if not full.startswith(os.path.normpath(root) + os.sep):
                    self.json(403, {"error": "forbidden"})
                    return True
                if not os.path.isfile(full):
                    self.json(404, {"error": "not found"})
                    return True
                ctype = {
                    ".png": "image/png", ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg", ".gif": "image/gif",
                    ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8",
                    ".js": "text/javascript", ".css": "text/css",
                    ".json": "application/json",
                }.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
                with open(full, "rb") as f:
                    self.blob(f.read(), ctype)
                return True
            return False

        def _dispatch(self, method: str) -> None:
            path = urllib.parse.urlparse(self.path).path
            if method == "GET" and self._serve_static(path):
                return
            fn, params = router.match(method, path)
            if fn is None:
                self.json(404, {"error": "not found"})
                return
            try:
                result = fn(Request(self, params))
                if result is not None:
                    self.json(200, result)
            except HttpError as exc:
                self.json(exc.status, {"error": exc.message})
            except ValueError as exc:
                self.json(400, {"error": str(exc)})
            except RuntimeError as exc:
                self.json(409, {"error": str(exc)})
            except (BrokenPipeError, ConnectionResetError):
                pass   # client walked away mid-stream
            except Exception as exc:  # noqa: BLE001
                log.exception("%s %s failed", method, path)
                self.json(500, {"error": str(exc)})

        def do_GET(self):  # noqa: N802
            self._dispatch("GET")

        def do_POST(self):  # noqa: N802
            self._dispatch("POST")

        def do_PUT(self):  # noqa: N802
            self._dispatch("PUT")

        def do_DELETE(self):  # noqa: N802
            self._dispatch("DELETE")

        def do_OPTIONS(self):  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

    return Handler


class ThreadingHTTPServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(router: Router, host: str, port: int, static: dict = None,
          background: bool = False):
    """Start an HTTP server for `router`. Blocks unless `background`."""
    httpd = ThreadingHTTPServer((host, port), make_handler(router, static))
    log.info("listening on http://%s:%d", host, port)
    if background:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        return httpd
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        httpd.server_close()
    return httpd
