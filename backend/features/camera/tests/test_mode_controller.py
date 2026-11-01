"""CameraModeController: the idle/face/gesture state machine, tested with
no hardware/MQTT — same spirit as features/radar/daemon.py's
PresenceTracker tests (inject `now` where timing matters)."""

import pytest

from features.camera.mode_controller import (
    CameraModeController, FACE_WINDOW_S, MANUAL_OVERRIDE_S,
)


# --- presence-driven: idle -> face -> gesture/idle -------------------------

def test_present_enters_face_mode():
    c = CameraModeController()
    assert c.on_presence("present", now=0.0) == "face"
    assert c.mode == "face"


def test_present_while_already_in_face_is_a_noop():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    assert c.on_presence("present", now=1.0) is None
    assert c.mode == "face"


def test_face_timeout_without_recognition_enters_gesture():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    assert c.on_face_timeout(now=FACE_WINDOW_S) == "gesture"
    assert c.mode == "gesture"


def test_gesture_mode_has_no_internal_timeout():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    c.on_face_timeout(now=FACE_WINDOW_S)
    for t in range(10, 1000, 10):
        assert c.on_face_result(matched=False, now=float(t)) is None
    assert c.mode == "gesture"


def test_face_result_with_a_match_returns_to_idle_and_stops_detection():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    assert c.on_face_result(matched=True, now=1.0) == "idle"
    assert c.mode == "idle"


def test_face_result_with_no_match_does_not_change_mode():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    assert c.on_face_result(matched=False, now=1.0) is None
    assert c.mode == "face"


def test_absent_from_face_returns_to_idle():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    assert c.on_presence("absent", now=2.0) == "idle"
    assert c.mode == "idle"


def test_absent_from_gesture_returns_to_idle():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    c.on_face_timeout(now=FACE_WINDOW_S)
    assert c.on_presence("absent", now=10.0) == "idle"
    assert c.mode == "idle"


def test_absent_from_idle_is_a_noop():
    c = CameraModeController()
    assert c.on_presence("absent", now=0.0) is None
    assert c.mode == "idle"


def test_stale_face_timeout_after_already_leaving_face_is_ignored():
    """A match arrives right as the 5s timer was also about to fire —
    recognition already moved us to idle, so the timer firing afterwards
    must not override that."""
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    c.on_face_result(matched=True, now=4.9)  # -> idle
    assert c.on_face_timeout(now=FACE_WINDOW_S) is None
    assert c.mode == "idle"


def test_stale_face_result_after_absent_is_ignored():
    c = CameraModeController()
    c.on_presence("present", now=0.0)
    c.on_presence("absent", now=1.0)  # -> idle
    assert c.on_face_result(matched=True, now=1.1) is None
    assert c.mode == "idle"


# --- manual dev-tab override ------------------------------------------------

def test_manual_mode_disables_presence_driving():
    c = CameraModeController()
    assert c.apply_manual("gesture", now=0.0) == "gesture"
    assert c.mode == "gesture"
    assert c.presence_driven is False


def test_presence_events_recorded_but_not_applied_while_overridden():
    c = CameraModeController()
    c.apply_manual("gesture", now=0.0)
    assert c.on_presence("present", now=1.0) is None
    assert c.mode == "gesture"  # unchanged, still the manual choice


def test_face_result_is_ignored_in_manual_mode():
    """So the developer can keep watching the overlay detect instead of it
    silently flipping to idle the moment it recognizes someone."""
    c = CameraModeController()
    c.apply_manual("face", now=0.0)
    assert c.on_face_result(matched=True, now=1.0) is None
    assert c.mode == "face"


def test_renew_manual_extends_the_override_window():
    c = CameraModeController()
    c.apply_manual("face", now=0.0)
    c.renew_manual(now=MANUAL_OVERRIDE_S - 1)
    # Had it not renewed, this point would already be past the original deadline.
    assert c.on_presence("present", now=MANUAL_OVERRIDE_S + 5) is None
    assert c.presence_driven is False


def test_manual_override_auto_expires_and_hands_back_to_idle_presence():
    c = CameraModeController()
    c.apply_manual("gesture", now=0.0)
    # No renewal — the next presence-machine touchpoint after the deadline
    # should notice the override lapsed and resume presence driving.
    assert c.on_presence("absent", now=MANUAL_OVERRIDE_S + 1) is None
    assert c.presence_driven is True
    assert c.mode == "idle"


def test_release_manual_resumes_face_flow_if_someone_is_already_present():
    """The developer was testing while a real person was already standing
    there — closing the dev tab should re-enter detection immediately, not
    wait for a fresh MQTT presence event that may never come."""
    c = CameraModeController()
    c.on_presence("present", now=0.0)  # real presence, before any override
    c.apply_manual("gesture", now=1.0)
    assert c.release_manual(now=5.0) == "face"
    assert c.mode == "face"
    assert c.presence_driven is True


def test_release_manual_with_nobody_present_returns_to_idle():
    c = CameraModeController()
    c.apply_manual("gesture", now=0.0)
    assert c.release_manual(now=5.0) == "idle"
    assert c.mode == "idle"
    assert c.presence_driven is True


def test_release_manual_from_an_already_idle_manual_choice_is_a_noop():
    """Manual mode was "idle" itself (e.g. the dev tab's clean/no-overlay
    choice) — releasing it changes nothing, so no mode-apply is needed."""
    c = CameraModeController()
    assert c.on_presence("absent", now=0.0) is None  # still idle
    c.apply_manual("idle", now=1.0)
    assert c.release_manual(now=2.0) is None
    assert c.mode == "idle"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
