import struct
import pytest
from ld2450_daemon import parse_frame, calculate_distance


def make_frame(targets):
    """Build a valid LD2450 frame with given targets (list of (x, y, speed))."""
    header = bytes([0xFD, 0xFC, 0xFB, 0xFA])
    footer = bytes([0x04, 0x03, 0x02, 0x01])
    data = b''
    for x, y, speed in targets:
        data += struct.pack('<hhH', x, y, speed)
    # pad to 3 targets
    while len(data) < 18:
        data += bytes(6)
    length = struct.pack('<H', len(data))
    return header + length + data + footer


def test_parse_valid_frame_single_target():
    frame = make_frame([(500, 1000, 0)])
    targets = parse_frame(frame)
    assert len(targets) == 3
    assert targets[0] == (500, 1000, 0)


def test_parse_valid_frame_no_target():
    frame = make_frame([(0, 0, 0)])
    targets = parse_frame(frame)
    assert targets[0] == (0, 0, 0)


def test_parse_invalid_header_returns_empty():
    bad_frame = bytes([0x00] * 26)
    targets = parse_frame(bad_frame)
    assert targets == []


def test_parse_frame_too_short_returns_empty():
    targets = parse_frame(bytes([0xFD, 0xFC]))
    assert targets == []


def test_calculate_distance():
    assert calculate_distance(0, 1000) == pytest.approx(1000.0)
    assert calculate_distance(500, 866) == pytest.approx(1000.0, abs=1.0)


def test_calculate_distance_zero():
    assert calculate_distance(0, 0) == 0.0


from ld2450_daemon import PresenceTracker


def test_presence_detected_when_target_in_zone():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=120)
    targets = [(200, 1000, 0)]  # x=200 <= 400, y=1000 <= 1500 -> in zone
    event = tracker.update(targets)
    assert event == 'PRESENT'


def test_no_event_when_already_present():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=120)
    tracker.update([(200, 1000, 0)])  # first: PRESENT
    event = tracker.update([(200, 1000, 0)])  # second: no change
    assert event is None


def test_no_event_when_target_too_wide():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=120)
    event = tracker.update([(600, 1000, 0)])  # x=600 > 400 -> outside zone
    assert event is None


def test_no_event_when_target_too_far():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=120)
    event = tracker.update([(200, 2000, 0)])  # y=2000 > 1500 -> outside zone
    assert event is None


def test_absent_event_after_timeout():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=0)
    tracker.update([(200, 1000, 0)])   # PRESENT
    event = tracker.update([(600, 2000, 0)])  # outside zone, timeout=0 -> immediate ABSENT
    assert event == 'ABSENT'


def test_no_repeat_absent_after_already_absent():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=0)
    tracker.update([(200, 1000, 0)])   # PRESENT
    tracker.update([(600, 2000, 0)])   # ABSENT
    event = tracker.update([(600, 2000, 0)])  # still absent, no repeat event
    assert event is None


def test_no_absent_event_before_timeout():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=9999)
    tracker.update([(200, 1000, 0)])   # PRESENT
    event = tracker.update([(600, 2000, 0)])  # outside zone but timeout not elapsed
    assert event is None


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
