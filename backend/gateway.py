"""Edge router on :8000 — the HTTP surface that remains after the MQTT move.

**MQTT is now the primary transport.** Every JSON operation the features used
to answer over HTTP is an RPC endpoint on the broker (see each feature's
`mqtt.py` and `MqttClient.serve`), and state is published retained so the app
subscribes instead of polling. This gateway therefore shrinks to two jobs:

  1. the surfaces pub/sub genuinely cannot carry —
       /stream.mjpg            multipart MJPEG, unbounded          (camera)
       /photo                  binary JPEG                         (camera)
       /module-assets/*        store screenshots                   (modules)
       /module-installed/*     a live module's own files            (modules)
       /module-draft/*         AI draft preview (zip, unpacked      (ai_modules)
                                client-side into the preview iframe)
       /mic/recording          test recording WAV bytes             (mic)
  2. the JSON twins kept as a **migration shim** while the frontend moves to
     MQTT screen by screen. Each twin calls the same handler as its RPC
     endpoint, so the two transports cannot drift.

Once the app is fully on MQTT, the JSON routes below go away too and this file
keeps only the binary/stream prefixes.

Routing (prefix → feature):
    /healthz /mode /resolution /stream.mjpg /photo /capture /encode
    /dataset /profiles /radar                       → camera      :8001
    /store /module-assets /module-installed         → modules     :8003
    /module-draft                                   → ai_modules  :8004
    /mic                                             → mic         :8005

The scenes feature is **not** here: it is MQTT-only and has no port.

`/api/modules/*` is deliberately **not** routed here: the AI builder's HTTP
surface (chat, chat/stream SSE, draft/session CRUD) from the pre-MQTT design
was removed when `ai_modules` became MQTT-only (see docs/features/ai_modules.md
— "there are no JSON HTTP twins… this feature was built MQTT-first"). The
frontend still calls those paths; that is a known, tracked frontend/backend
gap (backend/README.md: "FE still speaks old API shapes… FE is reworked
after the backend"), not something this gateway should paper over by
routing to a port that answers something else.

Anything else is 404. Streaming responses (MJPEG, SSE) are piped chunk by
chunk rather than buffered, so the live preview works.
"""

import argparse
import http.client
import logging
import os
import socketserver
import urllib.parse
from http import server

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s gateway: %(message)s")
log = logging.getLogger("gateway")

HOST = os.environ.get("GATEWAY_HOST", "0.0.0.0")
PORT = int(os.environ.get("GATEWAY_PORT", "8000"))

CAMERA = ("127.0.0.1", int(os.environ.get("CAMERA_PORT", "8001")))
MODULES = ("127.0.0.1", int(os.environ.get("MODULES_PORT", "8003")))
AI_MODULES = ("127.0.0.1", int(os.environ.get("AI_MODULES_PORT", "8004")))
MIC = ("127.0.0.1", int(os.environ.get("MIC_PORT", "8005")))

# Longest prefix wins, so /module-draft could not be swallowed by a
# hypothetical shorter /module- route.
ROUTES = [
    ("/healthz", CAMERA), ("/mode", CAMERA), ("/resolution", CAMERA),
    ("/stream.mjpg", CAMERA), ("/photo", CAMERA), ("/capture", CAMERA),
    ("/encode", CAMERA), ("/dataset", CAMERA), ("/profiles", CAMERA),
    ("/radar", CAMERA),

    ("/store", MODULES), ("/module-assets", MODULES),
    ("/module-installed", MODULES),

    ("/module-draft", AI_MODULES),

    ("/mic", MIC),
]
ROUTES.sort(key=lambda r: -len(r[0]))

# Responses to pipe instead of buffer: unbounded or long-lived bodies.
_STREAMING_TYPES = ("multipart/x-mixed-replace", "text/event-stream")


def route_for(path: str):
    for prefix, target in ROUTES:
        if path == prefix or path.startswith(prefix + "/") \
                or path.startswith(prefix + "?"):
            return target
    return None


class Handler(server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):   # journald already timestamps
        return

    def _error(self, code: int, message: str) -> None:
        body = f'{{"error": "{message}"}}'.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _relay(self) -> None:
        path = self.path
        target = route_for(urllib.parse.urlparse(path).path)
        if target is None:
            self._error(404, "not found")
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None

        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "connection", "accept-encoding")}
        headers["Connection"] = "close"

        try:
            # No read timeout: MJPEG and SSE responses are meant to hang open.
            conn = http.client.HTTPConnection(*target, timeout=None)
            conn.request(self.command, path, body=body, headers=headers)
            upstream = conn.getresponse()
        except Exception as exc:  # noqa: BLE001
            log.warning("%s %s -> %s:%d failed: %s", self.command, path,
                        target[0], target[1], exc)
            self._error(502, "upstream unavailable")
            return

        ctype = upstream.getheader("Content-Type", "")
        streaming = any(t in ctype for t in _STREAMING_TYPES)

        self.send_response(upstream.status)
        for k, v in upstream.getheaders():
            if k.lower() in ("connection", "transfer-encoding"):
                continue
            if streaming and k.lower() == "content-length":
                continue
            self.send_header(k, v)
        if streaming:
            # The upstream writes frames/events until the client leaves; we
            # cannot announce a length, so close-delimit the response.
            self.send_header("Connection", "close")
        self.end_headers()

        try:
            while True:
                chunk = upstream.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                if streaming:
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _relay

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    ap = argparse.ArgumentParser(description="Smart mirror API gateway")
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    log.info("gateway on http://%s:%d → camera %d / modules %d / "
             "ai_modules %d / mic %d",
             args.host, args.port, CAMERA[1], MODULES[1], AI_MODULES[1],
             MIC[1])
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
