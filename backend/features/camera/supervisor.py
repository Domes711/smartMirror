"""Camera arbiter: the single authority over the exclusive RPi camera.

Only one process may open the camera, so this one holds a *mode* and
guarantees exactly one consumer owns the device:

    face_detect   release the camera, start the production recognition daemon
    test_face     stop the daemon, open the camera here, stream + face overlay
    test_gesture  stop the daemon, open the camera here, stream + hand overlay
    learn         like test_face but keeps a clean frame for enrollment

This process keeps only what genuinely must share one process with the
hardware lock (mode machine, capture loop, MJPEG, enrollment capture). Scenes
and the module store live in their own features.

The mode is persisted to `var/camera-mode.state`, so the supervisor restores
it on boot. Default is `face_detect` so the mirror behaves normally after a
power-on.
"""

import logging
import os
import threading
import time

from shared import systemctl
from shared import paths

from . import constants as topics

log = logging.getLogger("camera.supervisor")

STATE_FILE = os.path.join(paths.VAR_DIR, "camera-mode.state")

DEFAULT_WIDTH = 640
DEFAULT_HEIGHT = 480
DEFAULT_TOLERANCE = 0.6
FACE_EVERY = 10           # run face detection every Nth frame (hog is slow)
GESTURE_EVERY = 3         # mediapipe is slow on the Pi
HAND_CONFIDENCE = 0.6
JPEG_QUALITY = 75
TARGET_FPS = 15           # cap the stream so the capture loop leaves CPU free
CAMERA_OPEN_RETRIES = 10  # wait for the daemon to release /dev after a stop

VALID_RESOLUTIONS = [(640, 480), (1280, 720), (1920, 1080), (2592, 1944)]

# cv2 constants, resolved lazily so this module still imports without opencv.
_CV2_ROTATION_CODES = {90: "ROTATE_90_CLOCKWISE", 180: "ROTATE_180",
                       270: "ROTATE_90_COUNTERCLOCKWISE"}


class _Cv2Rotation(dict):
    """Maps degrees → the cv2 rotation code, 0 → None (no rotation)."""

    def get(self, degrees, default=None):      # noqa: D102
        name = _CV2_ROTATION_CODES.get(int(degrees or 0))
        if name is None:
            return default
        import cv2
        return getattr(cv2, name)


_CV2_ROTATION = _Cv2Rotation()


def _camera_config() -> dict:
    """Camera settings from `camera_config`, falling back to the constants
    above if the DB is unreachable — the supervisor must still start and
    serve a stream on a broken DB."""
    out = {"width": DEFAULT_WIDTH, "height": DEFAULT_HEIGHT,
           "tolerance": DEFAULT_TOLERANCE, "rotation": 180}
    try:
        from data import device_config
        from shared import db
        db.init()
        cfg = device_config.resolve("camera")
        if cfg.get("resolution_width"):
            out["width"] = int(cfg["resolution_width"])
        if cfg.get("resolution_height"):
            out["height"] = int(cfg["resolution_height"])
        if cfg.get("recognition_tolerance") is not None:
            out["tolerance"] = float(cfg["recognition_tolerance"])
        if cfg.get("rotation") is not None:
            out["rotation"] = int(cfg["rotation"])
    except Exception as exc:  # noqa: BLE001
        log.warning("camera_config unreadable, using constants: %s", exc)
    return out

# "learn" is a streaming mode used by face enrollment; it is not offered in
# the app's mode switcher, only entered by the enrollment flow.
MODES = ("face_detect", "test_face", "test_gesture", "learn")
DEFAULT_MODE = "face_detect"

_OVERLAY_FOR = {"test_face": "face", "test_gesture": "gesture",
                "learn": "learn"}


class StreamingOutput:
    """Holds the latest JPEG frame; stream handlers wait on the condition."""

    def __init__(self):
        self.frame = None
        self.condition = threading.Condition()

    def write(self, buf: bytes) -> None:
        with self.condition:
            self.frame = buf
            self.condition.notify_all()


class Supervisor:
    def __init__(self, width=None, height=None, tolerance=None,
                 encodings=paths.ENCODINGS_PATH):
        # Camera settings live in `camera_config` (defaults seeded by the
        # migration); an explicit argument still wins, so the CLI flags in
        # service.py keep working. The camera is the one device without
        # per-profile overrides: it is what determines the profile, so it
        # cannot be configured per person.
        cfg = _camera_config()
        self.width = width if width is not None else cfg["width"]
        self.height = height if height is not None else cfg["height"]
        self.tolerance = (tolerance if tolerance is not None
                          else cfg["tolerance"])
        self.rotation = cfg["rotation"]
        self.encodings = encodings

        self.output = StreamingOutput()
        self.lock = threading.RLock()          # serialize mode transitions
        self.mode = DEFAULT_MODE

        # One persistent camera instance and one capture thread. We never
        # close/reopen the camera just to switch between test modes
        # (libcamera struggles to re-acquire within the same process);
        # instead we keep the instance and only flip self.overlay.
        self.picam = None
        self.overlay = None       # "face" | "gesture" | "learn" | None
        self.last_raw = None      # latest clean frame, for enrollment capture
        self.capture_thread = None
        self.stop_capture = threading.Event()
        self.camera_open = False
        self.fps = 0.0

        # lazily-built detectors, cached across overlay switches
        self._mp = None
        self._hands = None
        self._count_fingers = None
        self._fr = None
        self._known_encodings = None
        self._known_names = None
        self._last_faces = []
        self._last_hands = []
        self._jpeg_encoder = None
        self._tjpf_rgb = None

        # Set by the service so mode/state changes reach MQTT.
        self.on_state_change = None

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
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
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
            service = topics.RECOGNITION_SERVICE

            if mode in _OVERLAY_FOR:
                # A streaming mode owns the camera. Stop the daemon if it is
                # installed so it is not holding the device, then reuse our
                # single camera instance and just flip the overlay.
                if systemctl.exists(service):
                    systemctl.run("stop", service)
                self.overlay = _OVERLAY_FOR[mode]
                self._ensure_capture()
            else:  # face_detect — hand the camera to the production daemon
                self.overlay = None
                self._pause_capture()
                if systemctl.exists(service):
                    self._release_camera()   # fully close so it can acquire
                    systemctl.run("start", service)
                # No daemon installed → keep the (paused) instance so
                # switching back to a test mode stays instant and reliable.

            self.mode = mode
            self.save_mode(mode)
            log.info("mode active: %s", mode)
        self._notify()

    def set_resolution(self, width: int, height: int) -> None:
        if (width, height) not in VALID_RESOLUTIONS:
            raise ValueError(f"invalid resolution: {width}x{height}")
        with self.lock:
            log.info("changing resolution: %dx%d -> %dx%d",
                     self.width, self.height, width, height)
            self.width, self.height = width, height
            if self.camera_open:
                was_capturing = (self.capture_thread is not None
                                 and self.capture_thread.is_alive())
                self._pause_capture()
                self._release_camera()
                if was_capturing:
                    self._ensure_capture()
        self._notify()

    def _notify(self) -> None:
        if self.on_state_change:
            try:
                self.on_state_change(self.health())
            except Exception:  # noqa: BLE001
                log.exception("state change hook failed")

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
                picam.configure(picam.create_preview_configuration(
                    main={"size": (self.width, self.height),
                          "format": "RGB888"}))
                picam.start()
                self.picam = picam
                self.camera_open = True
                log.info("camera open (%dx%d)", self.width, self.height)
                return
            except Exception as exc:  # noqa: BLE001 — device may be busy
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
        self._ensure_camera()
        if self.capture_thread is None or not self.capture_thread.is_alive():
            self.stop_capture.clear()
            self.capture_thread = threading.Thread(target=self._capture_loop,
                                                   daemon=True)
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

    def shutdown(self) -> None:
        self._pause_capture()
        self._release_camera()

    def _encode_jpeg(self, cv2, frame) -> bytes:
        """TurboJPEG when available (3-5× faster on the Pi), cv2 otherwise."""
        if self._jpeg_encoder is None:
            try:
                from turbojpeg import TJPF_RGB, TurboJPEG
                self._jpeg_encoder = TurboJPEG()
                self._tjpf_rgb = TJPF_RGB
                log.info("TurboJPEG encoder initialized")
            except ImportError:
                log.warning("TurboJPEG not available, falling back to cv2")
                self._jpeg_encoder = False   # sentinel: do not retry
        if self._jpeg_encoder:
            return self._jpeg_encoder.encode(frame, quality=JPEG_QUALITY,
                                             pixel_format=self._tjpf_rgb)
        # cv2 expects BGR; our frames are RGB.
        ok, jpg = cv2.imencode(".jpg", cv2.cvtColor(frame, cv2.COLOR_RGB2BGR),
                               [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        return jpg.tobytes() if ok else None

    def _capture_loop(self) -> None:
        import cv2
        frame_idx = 0
        last_t = time.monotonic()
        try:
            for _ in range(3):   # discard warm-up frames
                self.picam.capture_array()
            while not self.stop_capture.is_set():
                frame = self.picam.capture_array()        # RGB888
                # The camera is mounted upside down on this mirror, so the
                # seeded default is 180. Read from camera_config, not pinned
                # in code, because remounting the camera is a config change.
                rot = _CV2_ROTATION.get(self.rotation)
                if rot is not None:
                    frame = cv2.rotate(frame, rot)
                frame_idx += 1

                overlay = self.overlay
                if overlay == "gesture":
                    self._draw_gesture(frame, frame_idx)
                elif overlay == "face":
                    self._draw_face(cv2, frame, frame_idx)
                elif overlay == "learn":
                    # snapshot the clean frame BEFORE drawing, for enrollment
                    self.last_raw = frame.copy()

                now = time.monotonic()
                dt = now - last_t
                last_t = now
                if dt > 0:
                    self.fps = 0.9 * self.fps + 0.1 * (1.0 / dt)

                jpg = self._encode_jpeg(cv2, frame)
                if jpg:
                    self.output.write(jpg)

                frame_time = time.monotonic() - now
                target = 1.0 / TARGET_FPS
                if frame_time < target:
                    time.sleep(target - frame_time)
        except Exception as exc:  # noqa: BLE001
            log.exception("capture loop error: %s", exc)
        finally:
            self.fps = 0.0
            log.info("capture loop stopped")

    # ---- overlays (lazy, cached across switches) ---------------------- #
    def _draw_gesture(self, frame, frame_idx) -> None:
        if self._hands is None:
            import mediapipe as mp
            from .gestures import count_fingers
            self._mp = mp
            self._count_fingers = count_fingers
            self._hands = mp.solutions.hands.Hands(
                static_image_mode=False, max_num_hands=1,
                min_detection_confidence=HAND_CONFIDENCE,
                min_tracking_confidence=HAND_CONFIDENCE)
        mp = self._mp
        if frame_idx % GESTURE_EVERY == 0:
            results = self._hands.process(frame)
            self._last_hands = []
            if results.multi_hand_landmarks:
                for lm, handed in zip(results.multi_hand_landmarks,
                                      results.multi_handedness):
                    self._last_hands.append(
                        (lm, handed, self._count_fingers(lm, handed)))
        # Draw the cached result on every frame, so the overlay stays smooth
        # even though detection only runs every GESTURE_EVERY frames.
        for lm, _handed, _n in self._last_hands:
            mp.solutions.drawing_utils.draw_landmarks(
                frame, lm, mp.solutions.hands.HAND_CONNECTIONS,
                mp.solutions.drawing_styles.get_default_hand_landmarks_style(),
                mp.solutions.drawing_styles.get_default_hand_connections_style())

    def _draw_face(self, cv2, frame, frame_idx) -> None:
        if self._fr is None:
            import face_recognition as fr
            self._fr = fr
            self._known_encodings, self._known_names = self._load_encodings()
        fr = self._fr
        if frame_idx % FACE_EVERY == 0:
            locs = fr.face_locations(frame, model="hog",
                                     number_of_times_to_upsample=0)
            faces = []
            for (top, right, bottom, left), enc in zip(
                    locs, fr.face_encodings(frame, locs)):
                name = "unknown"
                if self._known_encodings:
                    matches = fr.compare_faces(self._known_encodings, enc,
                                               tolerance=self.tolerance)
                    for known, hit in zip(self._known_names, matches):
                        if hit:
                            name = known
                            break
                faces.append((top, right, bottom, left, name))
            self._last_faces = faces
        for (top, right, bottom, left, _name) in self._last_faces:
            cv2.rectangle(frame, (left, top), (right, bottom), (255, 0, 0), 1)

    def _load_encodings(self):
        import pickle
        try:
            with open(self.encodings, "rb") as f:
                data = pickle.load(f)
            log.info("loaded %d face encodings: %s", len(data["encodings"]),
                     ", ".join(sorted(set(data["names"]))) or "none")
            return data["encodings"], data["names"]
        except Exception as exc:  # noqa: BLE001
            log.warning("could not load encodings (%s): %s", self.encodings, exc)
            return [], []

    def drop_encoding_cache(self) -> None:
        """Force a reload on the next face/learn frame (after retraining)."""
        self._fr = None
        self._known_encodings = None
        self._known_names = None

    # ---- status ------------------------------------------------------- #
    def health(self) -> dict:
        detected_face = None
        finger_count = None
        if self.mode in ("test_face", "learn") and self._last_faces:
            detected_face = self._last_faces[0][4] or "unknown"
        if self.mode == "test_gesture" and self._last_hands:
            finger_count = self._last_hands[0][2]
        return {
            "mode": self.mode,
            "modes": list(MODES),
            "camera_open": self.camera_open,
            "daemon_active": systemctl.is_active(topics.RECOGNITION_SERVICE),
            "fps": round(self.fps, 1),
            "width": self.width,
            "height": self.height,
            "detected_face": detected_face,
            "finger_count": finger_count,
        }
