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
    """Run `sudo systemctl <action> face_reco` (allowed via sudoers)."""
    try:
        subprocess.run(
            ["sudo", SYSTEMCTL, action, FACE_SERVICE],
            check=False, capture_output=True, timeout=15,
        )
        log.info("systemctl %s %s", action, FACE_SERVICE)
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


# --------------------------------------------------------------------------- #
# Supervisor: owns the mode + the camera capture thread
# --------------------------------------------------------------------------- #
class Supervisor:
    def __init__(self, args):
        self.args = args
        self.output = StreamingOutput()
        self.lock = threading.RLock()          # serialize mode transitions
        self.mode = DEFAULT_MODE
        self.capture_thread = None
        self.stop_capture = threading.Event()
        self.camera_open = False
        self.fps = 0.0

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
            # 1) release whoever currently holds the camera
            self._stop_capture()
            _systemctl("stop")  # idempotent; ensures daemon isn't holding it

            # 2) hand the camera to the new owner
            if mode in ("test_face", "test_gesture"):
                self._start_capture(face=(mode == "test_face"))
            elif mode == "face_detect":
                _systemctl("start")

            self.mode = mode
            self.save_mode(mode)
            log.info("mode active: %s", mode)

    # ---- capture lifecycle -------------------------------------------- #
    def _start_capture(self, face: bool) -> None:
        self.stop_capture.clear()
        self.capture_thread = threading.Thread(
            target=self._capture_loop, args=(face,), daemon=True,
        )
        self.capture_thread.start()

    def _stop_capture(self) -> None:
        if self.capture_thread and self.capture_thread.is_alive():
            self.stop_capture.set()
            self.capture_thread.join(timeout=5)
        self.capture_thread = None
        self.camera_open = False

    def _open_camera(self):
        """Open Picamera2, retrying while the daemon releases the device."""
        from picamera2 import Picamera2
        last_exc = None
        for attempt in range(CAMERA_OPEN_RETRIES):
            try:
                picam = Picamera2()
                config = picam.create_preview_configuration(
                    main={"size": (self.args.width, self.args.height),
                          "format": "RGB888"}
                )
                picam.configure(config)
                picam.start()
                return picam
            except Exception as exc:  # noqa: BLE001 -- device may be busy
                last_exc = exc
                log.info("camera busy, retry %d/%d", attempt + 1,
                         CAMERA_OPEN_RETRIES)
                time.sleep(0.5)
        raise RuntimeError(f"could not open camera: {last_exc}")

    def _capture_loop(self, face: bool) -> None:
        import cv2

        try:
            picam = self._open_camera()
        except Exception as exc:  # noqa: BLE001
            log.error("%s", exc)
            return

        self.camera_open = True
        log.info("camera open (%dx%d), overlay=%s",
                 self.args.width, self.args.height,
                 "face" if face else "gesture")

        # init the requested detector once
        hands = mp_hands = mp_drawing = mp_styles = None
        face_recognition = known_encodings = known_names = None
        last_faces = []
        if face:
            import face_recognition as _fr
            face_recognition = _fr
            known_encodings, known_names = self._load_encodings()
        else:
            from gesture_reco_once import count_fingers
            import mediapipe as mp
            mp_hands = mp.solutions.hands
            mp_drawing = mp.solutions.drawing_utils
            mp_styles = mp.solutions.drawing_styles
            hands = mp_hands.Hands(
                static_image_mode=False, max_num_hands=1,
                min_detection_confidence=HAND_CONFIDENCE,
                min_tracking_confidence=HAND_CONFIDENCE,
            )

        # discard a few warm-up frames
        for _ in range(3):
            picam.capture_array()

        frame_idx = 0
        last_t = time.monotonic()
        try:
            while not self.stop_capture.is_set():
                frame = picam.capture_array()  # RGB888 == BGR for cv2
                frame_idx += 1

                if hands is not None:
                    results = hands.process(frame)
                    if results.multi_hand_landmarks:
                        for lm, handed in zip(results.multi_hand_landmarks,
                                              results.multi_handedness):
                            mp_drawing.draw_landmarks(
                                frame, lm, mp_hands.HAND_CONNECTIONS,
                                mp_styles.get_default_hand_landmarks_style(),
                                mp_styles.get_default_hand_connections_style(),
                            )
                            n = count_fingers(lm, handed)
                            cv2.putText(frame, f"fingers: {n}",
                                        (10, self.args.height - 20),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                                        (0, 255, 0), 2)

                if face_recognition is not None:
                    if frame_idx % FACE_EVERY == 0:
                        locs = face_recognition.face_locations(
                            frame, model="hog", number_of_times_to_upsample=0)
                        encs = face_recognition.face_encodings(frame, locs)
                        last_faces = []
                        for (top, right, bottom, left), enc in zip(locs, encs):
                            name = "unknown"
                            if known_encodings:
                                matches = face_recognition.compare_faces(
                                    known_encodings, enc,
                                    tolerance=self.args.tolerance)
                                for known, hit in zip(known_names, matches):
                                    if hit:
                                        name = known
                                        break
                            last_faces.append((top, right, bottom, left, name))
                    for (top, right, bottom, left, name) in last_faces:
                        cv2.rectangle(frame, (left, top), (right, bottom),
                                      (255, 128, 0), 2)
                        cv2.putText(frame, name, (left, max(top - 8, 12)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                                    (255, 128, 0), 2)

                # HUD + fps
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
        finally:
            picam.stop()
            if hands is not None:
                hands.close()
            self.camera_open = False
            self.fps = 0.0
            log.info("camera released")

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
            if self.path == "/healthz":
                self._json(200, sup.health())
            elif self.path == "/mode":
                self._json(200, {"mode": sup.mode})
            elif self.path == "/stream.mjpg":
                self._stream()
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/mode":
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
        sup._stop_capture()
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
