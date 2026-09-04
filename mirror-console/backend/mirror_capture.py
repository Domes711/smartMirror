#!/usr/bin/env python3
"""Live screencast of the REAL MagicMirror screen.

The Home screen of the app used to embed `http://<pi>:8080` in an iframe. That
is a *second, independent* MagicMirror client — it re-renders the page from
scratch and therefore never shows what the physical mirror actually has on
screen. This module streams the mirror's own Electron renderer instead, over
the Chrome DevTools Protocol, so the app shows the exact pixels on the glass.

How it works
------------
`start-magicmirror.sh` launches Electron with `--remote-debugging-port`
(default 9222, bound to 127.0.0.1 by Chromium). We discover the page target
over the DevTools HTTP endpoint, open a WebSocket to it and run
`Page.startScreencast`, which pushes base64 JPEG frames whenever the page
repaints. Each frame must be acked or the stream stalls.

Screencast only emits on *change*, and the mirror is mostly static, so we also
fire a `Page.captureScreenshot` to prime the first frame immediately and again
as a keepalive whenever no frame arrived for a while. Callers therefore always
get a picture, and a repainting mirror costs almost nothing.

Capture is lazy and refcounted: the CDP session only exists while somebody is
watching (`acquire()` / `release()`), so an idle Pi does no work.

Pure stdlib on purpose — the supervisor has no third-party HTTP/WS deps and we
are not adding any. `_WebSocket` below is a minimal RFC 6455 *client*: text
frames, masking, continuation reassembly, ping/pong. Nothing more is needed to
talk to DevTools on localhost.
"""

import base64
import hashlib
import json
import logging
import os
import secrets
import select
import socket
import struct
import threading
import time
import urllib.request

log = logging.getLogger("mirror_capture")

_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

DEFAULT_DEBUG_PORT = int(os.environ.get("MM_DEBUG_PORT", "9222"))
# JPEG quality of the screencast frames. The mirror is mostly flat black with
# white text, which compresses extremely well — 60 is visually lossless here.
DEFAULT_QUALITY = 60
# Downscale cap sent to the screencast. The mirror renders 1080x1920; the app
# shows it in a ~48dvh card on a phone, so half resolution is plenty and keeps
# frames small enough to push over Wi-Fi/Tailscale.
DEFAULT_MAX_W = 720
DEFAULT_MAX_H = 1280
# Ask for a fresh screenshot when the (static) page produced no frame for this
# long, so a viewer that connects mid-idle still gets a current picture.
KEEPALIVE_S = 5.0
# Keep the CDP session open this long after the last viewer leaves — reopening
# it on every navigation between app tabs would be wasteful and slow.
IDLE_GRACE_S = 20.0
# Beyond this the newest frame we hold is not "the mirror right now" any more —
# the session is broken (Electron restarting, debug port gone). Report it as
# unavailable rather than silently serving a frozen picture, so the app can say
# so instead of showing a stale mirror as if it were live.
STALE_S = 3 * KEEPALIVE_S


class CaptureError(RuntimeError):
    """Screencast could not be established (Electron down, no debug port…)."""


# --------------------------------------------------------------------------- #
# Minimal WebSocket client (RFC 6455) — enough for DevTools on localhost.
# --------------------------------------------------------------------------- #
class _WebSocket:
    def __init__(self, url: str, timeout: float = 20.0):
        if not url.startswith("ws://"):
            raise CaptureError(f"unsupported websocket url: {url}")
        hostport, _, path = url[len("ws://"):].partition("/")
        host, _, port = hostport.partition(":")
        self._send_lock = threading.Lock()
        self._buf = b""
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        key = base64.b64encode(secrets.token_bytes(16)).decode()
        # No Origin header on purpose: Chromium rejects DevTools websockets
        # from a non-null origin unless it was started with
        # --remote-allow-origins, and an origin-less client is always allowed.
        self.sock.sendall(
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {host}:{port or 80}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n".encode()
        )
        head = self._read_until(b"\r\n\r\n")
        status = head.split(b"\r\n", 1)[0]
        if b" 101 " not in status:
            raise CaptureError(f"websocket handshake failed: {status.decode('latin1')}")
        expect = base64.b64encode(hashlib.sha1((key + _WS_GUID).encode()).digest())
        if expect not in head:
            raise CaptureError("websocket handshake: bad Sec-WebSocket-Accept")

    # --- low-level io ---
    def _read_until(self, sep: bytes) -> bytes:
        while sep not in self._buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise CaptureError("connection closed during handshake")
            self._buf += chunk
        head, self._buf = self._buf.split(sep, 1)
        return head + sep

    def _recv_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self._buf)))
            if not chunk:
                raise CaptureError("connection closed")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = secrets.token_bytes(4)
        header += mask
        masked = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        with self._send_lock:
            self.sock.sendall(bytes(header) + masked)

    # --- public ---
    def send_json(self, obj: dict) -> None:
        self._send_frame(0x1, json.dumps(obj).encode("utf-8"))

    def readable(self, timeout: float) -> bool:
        """True if a message is (at least partly) available — lets the caller
        run periodic work instead of blocking forever in recv()."""
        if self._buf:
            return True
        return bool(select.select([self.sock], [], [], timeout)[0])

    def recv_json(self):
        """Read one complete text message, reassembling continuation frames.
        Returns None for frames we don't care about (binary/control)."""
        chunks = []
        while True:
            b0, b1 = self._recv_exact(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            masked, n = b1 & 0x80, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if masked else None
            data = self._recv_exact(n) if n else b""
            if mask:
                data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
            if opcode == 0x8:
                raise CaptureError("websocket closed by peer")
            if opcode == 0x9:          # ping -> pong
                self._send_frame(0xA, data)
                continue
            if opcode == 0xA:          # pong
                continue
            chunks.append(data)
            if fin:
                try:
                    return json.loads(b"".join(chunks).decode("utf-8"))
                except ValueError:
                    return None

    def close(self) -> None:
        try:
            self._send_frame(0x8, b"")
        except Exception:  # noqa: BLE001
            pass
        try:
            self.sock.close()
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- #
# Screencast
# --------------------------------------------------------------------------- #
class MirrorCapture:
    """Refcounted CDP screencast of the live mirror page."""

    def __init__(self, port: int = DEFAULT_DEBUG_PORT, quality: int = DEFAULT_QUALITY,
                 max_w: int = DEFAULT_MAX_W, max_h: int = DEFAULT_MAX_H):
        self.port = port
        self.quality = quality
        self.max_w = max_w
        self.max_h = max_h

        self.condition = threading.Condition()
        self.frame = None            # latest JPEG bytes
        self.frame_ts = 0.0

        self._lock = threading.Lock()
        self._viewers = 0
        self._thread = None
        # Guarded by _lock together with the retire decision in _should_exit():
        # a viewer arriving exactly as the worker retires must either keep the
        # worker alive or start a new one, never fall between the two.
        self._running = False
        self._stop = threading.Event()
        self._error = None
        self._connected = False
        self._last_release = 0.0

    # --- viewer refcount ---------------------------------------------------
    def acquire(self) -> None:
        with self._lock:
            self._viewers += 1
            if not self._running:
                self._running = True
                self._stop.clear()
                self._thread = threading.Thread(
                    target=self._worker, name="mirror-capture", daemon=True)
                self._thread.start()

    def release(self) -> None:
        with self._lock:
            self._viewers = max(0, self._viewers - 1)
            if self._viewers == 0:
                self._last_release = time.time()

    def status(self) -> dict:
        with self.condition:
            age = (time.time() - self.frame_ts) if self.frame_ts else None
        return {
            "port": self.port,
            "connected": self._connected,
            "viewers": self._viewers,
            "frame_age": round(age, 2) if age is not None else None,
            "error": self._error,
        }

    def snapshot(self, timeout: float = 6.0):
        """One JPEG of the live mirror, or None if the screencast is not up.

        Starts the session if needed. Never returns a frame older than STALE_S:
        a frozen picture presented as live is worse than an honest error."""
        self.acquire()
        try:
            deadline = time.time() + timeout
            with self.condition:
                # Prefer a *current* frame: on a static page the keepalive
                # screenshot refreshes it every KEEPALIVE_S.
                while self.frame is None or (time.time() - self.frame_ts) > KEEPALIVE_S:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        break
                    self.condition.wait(remaining)
                if self.frame is None or (time.time() - self.frame_ts) > STALE_S:
                    return None
                return self.frame
        finally:
            self.release()

    def frames(self, timeout: float = 30.0):
        """Yield JPEG frames as they arrive (for the MJPEG endpoint)."""
        self.acquire()
        try:
            last_ts = 0.0
            idle_deadline = time.time() + timeout
            while True:
                with self.condition:
                    if self.frame_ts <= last_ts:
                        self.condition.wait(1.0)
                    if self.frame is not None and self.frame_ts > last_ts:
                        last_ts = self.frame_ts
                        frame = self.frame
                    else:
                        frame = None
                if frame is not None:
                    idle_deadline = time.time() + timeout
                    yield frame
                elif time.time() > idle_deadline:
                    return
        finally:
            self.release()

    # --- CDP session -------------------------------------------------------
    def _publish(self, jpeg: bytes) -> None:
        with self.condition:
            self.frame = jpeg
            self.frame_ts = time.time()
            self.condition.notify_all()

    def _find_target(self) -> dict:
        """Pick the mirror's page target from the DevTools target list."""
        # Explicitly proxy-less: a HTTP(S)_PROXY in the service environment must
        # never be used for a localhost DevTools call.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        hint = (f"is MagicMirror running with --remote-debugging-port={self.port}? "
                "(start-magicmirror.sh passes it; MM_DEBUG_PORT=0 disables it)")
        try:
            with opener.open(f"http://127.0.0.1:{self.port}/json/list", timeout=3) as resp:
                targets = json.load(resp)
        except OSError as exc:
            raise CaptureError(f"DevTools port {self.port} unreachable ({exc}) — {hint}") from exc
        pages = [t for t in targets
                 if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
        if not pages:
            raise CaptureError(f"no page target on 127.0.0.1:{self.port} — {hint}")
        # Prefer the actual mirror document over any about:blank/devtools target.
        for t in pages:
            if "localhost" in (t.get("url") or "") or "127.0.0.1" in (t.get("url") or ""):
                return t
        return pages[0]

    def _worker(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    self._session()
                except Exception as exc:  # noqa: BLE001
                    self._connected = False
                    self._error = str(exc)
                    log.warning("mirror capture: %s", exc)
                    # Electron may simply be restarting (pm2 restart MagicMirror).
                    for _ in range(20):
                        if self._stop.is_set() or self._should_exit():
                            return
                        time.sleep(0.1)
                if self._should_exit():
                    return
        finally:
            # Only clear the flag if a *newer* worker has not taken over.
            with self._lock:
                if self._thread is threading.current_thread():
                    self._running = False

    def _should_exit(self) -> bool:
        """Retire the worker once nobody has watched for IDLE_GRACE_S.

        Decided under _lock so it cannot interleave with acquire(): either the
        viewer is counted and the worker stays, or the worker is marked stopped
        and the viewer starts a fresh one."""
        with self._lock:
            if self._viewers == 0 and (time.time() - self._last_release) > IDLE_GRACE_S:
                self._running = False
                return True
            return False

    def _idle_expired(self) -> bool:
        """Non-committal check used inside a session loop (no state change)."""
        with self._lock:
            return self._viewers == 0 and (time.time() - self._last_release) > IDLE_GRACE_S

    def _session(self) -> None:
        target = self._find_target()
        ws = _WebSocket(target["webSocketDebuggerUrl"])
        self._connected = True
        self._error = None
        log.info("mirror capture: attached to %s", target.get("url"))
        msg_id = [0]

        def send(method, params=None):
            msg_id[0] += 1
            ws.send_json({"id": msg_id[0], "method": method, "params": params or {}})
            return msg_id[0]

        try:
            send("Page.enable")
            send("Page.startScreencast", {
                "format": "jpeg", "quality": self.quality,
                "maxWidth": self.max_w, "maxHeight": self.max_h,
                "everyNthFrame": 1,
            })
            # Prime immediately — a static mirror emits no screencast frame
            # until something repaints, and a viewer should not stare at an
            # empty box until the clock ticks.
            shot_ids = {send("Page.captureScreenshot",
                             {"format": "jpeg", "quality": self.quality})}
            last_shot = time.time()

            while not self._stop.is_set():
                if self._idle_expired():
                    break
                if ws.readable(0.5):
                    data = ws.recv_json()
                    if not data:
                        continue
                    if data.get("method") == "Page.screencastFrame":
                        params = data.get("params") or {}
                        if params.get("data"):
                            self._publish(base64.b64decode(params["data"]))
                        # Unacked frames stall the screencast — always ack.
                        if "sessionId" in params:
                            send("Page.screencastFrameAck",
                                 {"sessionId": params["sessionId"]})
                    elif data.get("id") in shot_ids:
                        shot_ids.discard(data["id"])
                        result = data.get("result") or {}
                        if result.get("data"):
                            self._publish(base64.b64decode(result["data"]))
                        elif data.get("error"):
                            raise CaptureError(str(data["error"]))
                    continue

                # Idle tick: keep a recent frame available on a static page.
                now = time.time()
                if now - max(self.frame_ts, last_shot) > KEEPALIVE_S:
                    last_shot = now
                    shot_ids.add(send("Page.captureScreenshot",
                                      {"format": "jpeg", "quality": self.quality}))
        finally:
            self._connected = False
            try:
                send("Page.stopScreencast")
            except Exception:  # noqa: BLE001
                pass
            ws.close()
