#!/usr/bin/env python3
"""Camera supervisor / arbiter for the smart mirror console.

The RPi camera is exclusive — only one process may open it at a time. This
supervisor is the single authority over the camera. It holds a *mode* and
guarantees exactly one consumer owns the camera:

    face_detect   -> release camera, start the production `face_reco` daemon
    test_face     -> stop the daemon, open camera here, stream with face overlay
    test_gesture  -> stop the daemon, open camera here, stream with hand/finger overlay

It serves a small HTTP API on 127.0.0.1:8001 (reached from the LAN through the
Node/Express front-end, which proxies to it):

    GET  /mode          -> {"mode": "..."}
    POST /mode          -> body {"mode": "..."}; switches mode, returns state
    GET  /healthz       -> {"mode","camera_open","daemon_active","fps", ...}
    GET  /stream.mjpg   -> multipart MJPEG (only meaningful in a test_* mode)

The mode is persisted to `mode.state` next to this file, so the supervisor
restores it on boot. Default (no state file) is `face_detect` so the mirror
behaves normally after a power-on.

Reused logic from the on-demand camera scripts (imported from ../camera):
    count_fingers()  from gesture_reco_once.py
    encodings pickle loaded the same way as face_reco_daemon.py
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
import time
from http import server
import socketserver

# --- locate the sibling camera/ dir to reuse finger-counting + encodings ---
_HERE = os.path.dirname(os.path.abspath(__file__))
_CAMERA_DIR = os.environ.get(
    "MIRROR_CAMERA_DIR",
    os.path.normpath(os.path.join(_HERE, "..", "..", "camera")),
)
if _CAMERA_DIR not in sys.path:
    sys.path.insert(0, _CAMERA_DIR)

# count_fingers() is imported lazily inside the gesture capture branch (see
# _capture_loop) so the supervisor — and the face/daemon modes — start even if
# the camera scripts' optional deps (paho, mediapipe) aren't importable.

# --- config ---
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8001
STATE_FILE = os.path.join(_HERE, "mode.state")

FACE_SERVICE = "face_reco"
SYSTEMCTL = "/usr/bin/systemctl"

DEFAULT_WIDTH = 640
DEFAULT_HEIGHT = 480
DEFAULT_ENCODINGS = os.path.join(_CAMERA_DIR, "encoded_faces.pickle")
DEFAULT_TOLERANCE = 0.6
FACE_EVERY = 5            # run face detection every Nth frame (hog is slow)
HAND_CONFIDENCE = 0.6
CAMERA_OPEN_RETRIES = 10  # wait for the daemon to release /dev after stop

MODES = ("face_detect", "test_face", "test_gesture")
DEFAULT_MODE = "face_detect"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s supervisor: %(message)s",
)
log = logging.getLogger("supervisor")


# --------------------------------------------------------------------------- #
# MJPEG plumbing
# --------------------------------------------------------------------------- #
class StreamingOutput:
    """Holds the latest JPEG frame; stream handlers wait on the condition."""

    def __init__(self):
        self.frame = None
        self.condition = threading.Condition()

    def write(self, buf: bytes) -> None:
        with self.condition:
            self.frame = buf
            self.condition.notify_all()


# --------------------------------------------------------------------------- #
# systemd helpers
# --------------------------------------------------------------------------- #
def _systemctl(action: str) -> None:
    """Run `sudo -n systemctl <action> face_reco` (allowed via sudoers).

    `-n` keeps sudo non-interactive: if the sudoers rule isn't installed yet it
    fails immediately instead of blocking on a password prompt with no TTY
    (which would otherwise hang startup before the HTTP server comes up).
    """
    try:
        res = subprocess.run(
            ["sudo", "-n", SYSTEMCTL, action, FACE_SERVICE],
            check=False, capture_output=True, text=True,
            stdin=subprocess.DEVNULL, timeout=15,
        )
        if res.returncode == 0:
            log.info("systemctl %s %s", action, FACE_SERVICE)
        else:
            log.warning("systemctl %s %s failed (rc=%d): %s", action,
                        FACE_SERVICE, res.returncode,
                        (res.stderr or "").strip())
    except Exception as exc:  # noqa: BLE001
        log.warning("systemctl %s failed: %s", action, exc)


def daemon_active() -> bool:
    try:
        out = subprocess.run(
            [SYSTEMCTL, "is-active", FACE_SERVICE],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() == "active"
    except Exception:  # noqa: BLE001
        return False


def _service_exists(name: str) -> bool:
    """True if the systemd unit <name>.service is installed."""
    try:
        out = subprocess.run(
            [SYSTEMCTL, "list-unit-files", f"{name}.service"],
            capture_output=True, text=True, timeout=10,
        )
        return f"{name}.service" in out.stdout
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------- #
# Supervisor: owns the mode + the camera capture thread
# --------------------------------------------------------------------------- #
class Supervisor:
    def __init__(self, args):
        self.args = args
        self.output = StreamingOutput()
        self.lock = threading.RLock()          # serialize mode transitions
        self.mode = DEFAULT_MODE
        # Single persistent camera instance + single capture thread. We never
        # close/reopen the camera just to switch between test modes (libcamera
        # struggles to re-acquire in the same process); instead we keep one
        # instance and only flip self.overlay.
        self.picam = None
        self.overlay = None                    # "face" | "gesture" | None
        self.capture_thread = None
        self.stop_capture = threading.Event()
        self.camera_open = False
        self.fps = 0.0
        # cached detectors (lazy, kept across overlay switches)
        self._mp = None
        self._hands = None
        self._count_fingers = None
        self._fr = None
        self._known_encodings = None
        self._known_names = None
        self._last_faces = []

    # ---- persistence -------------------------------------------------- #
    def load_mode(self) -> str:
        try:
            with open(STATE_FILE) as f:
                m = f.read().strip()
            if m in MODES:
                return m
        except FileNotFoundError:
            pass
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read state file: %s", exc)
        return DEFAULT_MODE

    def save_mode(self, mode: str) -> None:
        try:
            with open(STATE_FILE, "w") as f:
                f.write(mode)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not write state file: %s", exc)

    # ---- mode transitions --------------------------------------------- #
    def apply_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown mode: {mode}")
        with self.lock:
            log.info("switching mode: %s -> %s", self.mode, mode)

            if mode in ("test_face", "test_gesture"):
                # A test mode owns the camera. If the daemon exists, stop it so
                # it isn't holding the device, then reuse our single camera
                # instance and just flip the overlay (no close/reopen).
                if _service_exists(FACE_SERVICE):
                    _systemctl("stop")
                self.overlay = "face" if mode == "test_face" else "gesture"
                self._ensure_capture()
            elif mode == "face_detect":
                # Hand the camera to the production daemon (if installed).
                self.overlay = None
                self._pause_capture()
                if _service_exists(FACE_SERVICE):
                    self._release_camera()   # fully close so the daemon can acquire
                    _systemctl("start")
                # else: no daemon here — keep the (paused) instance so switching
                # back to a test mode is instant and reliable.

            self.mode = mode
            self.save_mode(mode)
            log.info("mode active: %s", mode)

    # ---- camera + capture lifecycle ----------------------------------- #
    def _ensure_camera(self) -> None:
        """Open the single persistent Picamera2 instance, or resume it."""
        if self.picam is not None:
            if not self.camera_open:
                self.picam.start()
                self.camera_open = True
            return
        from picamera2 import Picamera2
        last_exc = None
        for attempt in range(CAMERA_OPEN_RETRIES):
            picam = None
            try:
                picam = Picamera2()
                config = picam.create_preview_configuration(
                    main={"size": (self.args.width, self.args.height),
                          "format": "RGB888"}
                )
                picam.configure(config)
                picam.start()
                self.picam = picam
                self.camera_open = True
                log.info("camera open (%dx%d)", self.args.width,
                         self.args.height)
                return
            except Exception as exc:  # noqa: BLE001 -- device may be busy
                last_exc = exc
                if picam is not None:
                    try:
                        picam.close()
                    except Exception:  # noqa: BLE001
                        pass
                log.info("camera busy, retry %d/%d", attempt + 1,
                         CAMERA_OPEN_RETRIES)
                time.sleep(0.5)
        raise RuntimeError(f"could not open camera: {last_exc}")

    def _ensure_capture(self) -> None:
        """Open the camera and start the capture thread if not running."""
        self._ensure_camera()
        if self.capture_thread is None or not self.capture_thread.is_alive():
            self.stop_capture.clear()
            self.capture_thread = threading.Thread(
                target=self._capture_loop, daemon=True)
            self.capture_thread.start()

    def _pause_capture(self) -> None:
        """Stop the capture thread and pause the camera (keep the instance)."""
        if self.capture_thread and self.capture_thread.is_alive():
            self.stop_capture.set()
            self.capture_thread.join(timeout=5)
        self.capture_thread = None
        if self.picam is not None and self.camera_open:
            try:
                self.picam.stop()
            except Exception:  # noqa: BLE001
                pass
        self.camera_open = False
        self.fps = 0.0

    def _release_camera(self) -> None:
        """Fully close the camera so another process can acquire it."""
        if self.picam is not None:
            try:
                self.picam.close()
            except Exception:  # noqa: BLE001
                pass
            self.picam = None
        self.camera_open = False

    def _capture_loop(self) -> None:
        import cv2
        frame_idx = 0
        last_t = time.monotonic()
        try:
            for _ in range(3):  # discard warm-up frames
                self.picam.capture_array()
            while not self.stop_capture.is_set():
                frame = self.picam.capture_array()  # RGB888 == BGR for cv2
                frame_idx += 1
                overlay = self.overlay
                if overlay == "gesture":
                    self._draw_gesture(cv2, frame)
                elif overlay == "face":
                    self._draw_face(cv2, frame, frame_idx)

                now = time.monotonic()
                dt = now - last_t
                last_t = now
                if dt > 0:
                    self.fps = 0.9 * self.fps + 0.1 * (1.0 / dt)
                cv2.putText(
                    frame,
                    f"{self.mode}  {self.args.width}x{self.args.height}  "
                    f"{self.fps:4.1f} fps",
                    (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

                ok, jpg = cv2.imencode(".jpg", frame)
                if ok:
                    self.output.write(jpg.tobytes())
        except Exception as exc:  # noqa: BLE001
            log.exception("capture loop error: %s", exc)
        finally:
            self.fps = 0.0
            log.info("capture loop stopped")

    # ---- overlays (lazy-initialized, cached across switches) ---------- #
    def _draw_gesture(self, cv2, frame) -> None:
        if self._hands is None:
            from gesture_reco_once import count_fingers
            import mediapipe as mp
            self._mp = mp
            self._count_fingers = count_fingers
            self._hands = mp.solutions.hands.Hands(
                static_image_mode=False, max_num_hands=1,
                min_detection_confidence=HAND_CONFIDENCE,
                min_tracking_confidence=HAND_CONFIDENCE,
            )
        mp = self._mp
        results = self._hands.process(frame)
        if results.multi_hand_landmarks:
            for lm, handed in zip(results.multi_hand_landmarks,
                                  results.multi_handedness):
                mp.solutions.drawing_utils.draw_landmarks(
                    frame, lm, mp.solutions.hands.HAND_CONNECTIONS,
                    mp.solutions.drawing_styles.get_default_hand_landmarks_style(),
                    mp.solutions.drawing_styles.get_default_hand_connections_style(),
                )
                n = self._count_fingers(lm, handed)
                cv2.putText(frame, f"fingers: {n}",
                            (10, self.args.height - 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

    def _draw_face(self, cv2, frame, frame_idx) -> None:
        if self._fr is None:
            import face_recognition as fr
            self._fr = fr
            self._known_encodings, self._known_names = self._load_encodings()
        fr = self._fr
        if frame_idx % FACE_EVERY == 0:
            locs = fr.face_locations(
                frame, model="hog", number_of_times_to_upsample=0)
            encs = fr.face_encodings(frame, locs)
            faces = []
            for (top, right, bottom, left), enc in zip(locs, encs):
                name = "unknown"
                if self._known_encodings:
                    matches = fr.compare_faces(
                        self._known_encodings, enc,
                        tolerance=self.args.tolerance)
                    for known, hit in zip(self._known_names, matches):
                        if hit:
                            name = known
                            break
                faces.append((top, right, bottom, left, name))
            self._last_faces = faces
        for (top, right, bottom, left, name) in self._last_faces:
            cv2.rectangle(frame, (left, top), (right, bottom), (255, 128, 0), 2)
            cv2.putText(frame, name, (left, max(top - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 128, 0), 2)

    def _load_encodings(self):
        import pickle
        try:
            with open(self.args.encodings, "rb") as f:
                data = pickle.load(f)
            log.info("loaded %d face encodings: %s", len(data["encodings"]),
                     ", ".join(sorted(set(data["names"]))) or "none")
            return data["encodings"], data["names"]
        except Exception as exc:  # noqa: BLE001
            log.warning("could not load encodings (%s): %s",
                        self.args.encodings, exc)
            return [], []

    # ---- status ------------------------------------------------------- #
    def health(self) -> dict:
        return {
            "mode": self.mode,
            "modes": list(MODES),
            "camera_open": self.camera_open,
            "daemon_active": daemon_active(),
            "fps": round(self.fps, 1),
            "width": self.args.width,
            "height": self.args.height,
        }


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #
def make_handler(sup: Supervisor):
    class Handler(server.BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            return

        def _json(self, code: int, obj: dict) -> None:
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            path = self.path.split("?", 1)[0]  # ignore query (e.g. ?k=cachebust)
            if path == "/healthz":
                self._json(200, sup.health())
            elif path == "/mode":
                self._json(200, {"mode": sup.mode})
            elif path == "/stream.mjpg":
                self._stream()
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path.split("?", 1)[0] != "/mode":
                self._json(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length) or b"{}")
                mode = payload.get("mode")
                sup.apply_mode(mode)
                self._json(200, sup.health())
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                log.exception("mode switch failed")
                self._json(500, {"error": str(exc)})

        def _stream(self):
            self.send_response(200)
            self.send_header("Age", "0")
            self.send_header("Cache-Control", "no-cache, private")
            self.send_header("Pragma", "no-cache")
            self.send_header(
                "Content-Type",
                "multipart/x-mixed-replace; boundary=FRAME")
            self.end_headers()
            try:
                while True:
                    with sup.output.condition:
                        sup.output.condition.wait(timeout=5)
                        frame = sup.output.frame
                    if frame is None:
                        continue
                    self.wfile.write(b"--FRAME\r\n")
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(frame)))
                    self.end_headers()
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError):
                pass

    return Handler


class ThreadingHTTPServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser(description="Smart mirror camera supervisor")
    parser.add_argument("--host", default=BACKEND_HOST)
    parser.add_argument("--port", type=int, default=BACKEND_PORT)
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--encodings", default=DEFAULT_ENCODINGS)
    args = parser.parse_args()

    sup = Supervisor(args)
    # restore persisted mode on boot
    sup.apply_mode(sup.load_mode())

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(sup))
    log.info("supervisor listening on http://%s:%d (mode=%s)",
             args.host, args.port, sup.mode)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        sup._pause_capture()
        sup._release_camera()
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
