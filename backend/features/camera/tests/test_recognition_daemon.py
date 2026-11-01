"""camera-recognition's camera init retry: the exclusive camera device is
briefly held by camera-supervisor on every mode handoff, so the very first
open attempt failing must not leave this daemon permanently dead — it has
to retry, the same way supervisor.py's own _ensure_camera() does for
itself.
"""

import sys
import types

import pytest


class FakePicamera2:
    """Stands in for picamera2.Picamera2: fails `start()` a fixed number of
    times across however many instances _init_camera's retry loop creates
    (simulating "camera busy, held by the other process" on each fresh
    open attempt), then succeeds — or fails forever, for the "still busy
    after all retries" case."""

    instances_created = 0
    starts_attempted = 0  # global, across every instance the retry loop makes
    fail_count = 0  # how many start() calls, total, should raise before succeeding

    def __init__(self):
        type(self).instances_created += 1
        self.started = False
        self.closed = False

    def create_preview_configuration(self, **_kwargs):
        return {}

    def configure(self, _config):
        pass

    def start(self):
        type(self).starts_attempted += 1
        if type(self).starts_attempted <= type(self).fail_count:
            raise RuntimeError("Pipeline handler in use by another process")
        self.started = True

    def capture_array(self):
        return [[0]]

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def fake_picamera2(monkeypatch):
    """Install a fake `picamera2` module so `from picamera2 import
    Picamera2` inside recognition_daemon.py resolves without the real
    (Pi-only) package installed."""
    FakePicamera2.instances_created = 0
    FakePicamera2.starts_attempted = 0
    FakePicamera2.fail_count = 0
    module = types.ModuleType("picamera2")
    module.Picamera2 = FakePicamera2
    monkeypatch.setitem(sys.modules, "picamera2", module)
    monkeypatch.setattr("time.sleep", lambda _s: None)  # skip real delays
    yield
    monkeypatch.delitem(sys.modules, "picamera2", raising=False)


def _daemon(known_encodings=None, known_names=None):
    from features.camera.recognition_daemon import FaceRecoDaemon
    return FaceRecoDaemon.__new__(FaceRecoDaemon)


def test_init_camera_succeeds_on_the_first_attempt():
    from features.camera.recognition_daemon import FaceRecoDaemon
    FakePicamera2.fail_count = 0
    daemon = _daemon()
    daemon._init_camera()
    assert daemon.picam is not None
    assert daemon.picam.started is True


def test_init_camera_retries_past_a_busy_camera():
    """Simulates exactly what we reproduced on the Pi: camera-supervisor
    still holding the device when this daemon's first open attempt runs."""
    FakePicamera2.fail_count = 3
    daemon = _daemon()
    daemon._init_camera(retries=10)
    assert daemon.picam is not None
    assert daemon.picam.started is True
    # Each failed attempt must have been closed before trying again, not
    # leaked.
    assert FakePicamera2.instances_created == 4  # 3 failures + 1 success


def test_init_camera_gives_up_after_exhausting_retries():
    FakePicamera2.fail_count = 999  # never succeeds
    daemon = _daemon()
    daemon._init_camera(retries=3)
    assert daemon.picam is None
    assert FakePicamera2.instances_created == 3


def test_perform_scan_retries_camera_init_if_still_none(monkeypatch):
    """The bug this guards against: a presence event arriving after the
    daemon gave up on its startup retries used to publish "nobody" forever
    with no further attempt, even once camera-supervisor had long since
    released the device. recognize_stream() itself (face_recognition's own
    pipeline) is stubbed out here — this test is only about the camera
    getting re-initialized, not about recognition matching."""
    from features.camera import recognition_daemon as mod
    import threading

    monkeypatch.setattr(mod, "recognize_stream",
                        lambda *a, **k: (None, "no_face"))

    published = []

    class FakeClient:
        def publish(self, topic, payload):
            published.append((topic, payload))

    daemon = _daemon()
    daemon.mqtt_client = FakeClient()
    daemon.known_encodings = []
    daemon.known_names = []
    daemon.max_duration = 0.01
    daemon.tolerance = 0.6
    daemon.scanning_lock = threading.Lock()
    daemon.is_scanning = False
    daemon.picam = None  # simulates the daemon having started with no camera

    FakePicamera2.fail_count = 0  # this retry attempt succeeds
    daemon._perform_scan()

    assert daemon.picam is not None
    assert daemon.picam.started is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
