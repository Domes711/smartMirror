import struct
import pytest
from features.radar.daemon import (FRAME_FOOTER, FRAME_HEADER,
                                   calculate_distance, parse_frame,
                                   RadarState, STREAM_TIMEOUT_S)


def _encode_signed(value: int) -> int:
    """Wire-encode a signed LD2450 field: bit 15 set means positive, bit 15
    clear means negative, low 15 bits are the magnitude. Inverse of
    daemon._decode_signed."""
    magnitude = abs(value) & 0x7FFF
    return magnitude | 0x8000 if value >= 0 else magnitude


def make_frame(targets):
    """Build a valid LD2450 **Engineering mode** frame (30 bytes).

    Layout: header(4) + 3 targets x 8 bytes + footer(2). Per target: X, Y and
    speed are each a sign-flag + magnitude 16-bit field (see _encode_signed),
    then 2 reserved bytes. `targets` is given in (x, y_mm, speed) and padded
    out to three slots with zeros.
    """
    data = b""
    for x, y_mm, speed in targets:
        data += struct.pack("<H", _encode_signed(x))
        data += struct.pack("<H", _encode_signed(y_mm))
        data += struct.pack("<H", _encode_signed(speed))
        data += bytes(2)                      # reserved
    data += bytes(24 - len(data))             # pad to 3 targets
    return FRAME_HEADER + data + FRAME_FOOTER


def test_parse_valid_frame_single_target():
    """Empty (0,0) slots are dropped, so one real target parses to one entry."""
    targets = parse_frame(make_frame([(500, 1000, 0)]))
    assert targets == [(500, 1000, 0)]


def test_parse_valid_frame_multiple_targets():
    targets = parse_frame(make_frame([(500, 1000, 0), (1200, 2000, 3)]))
    assert targets == [(500, 1000, 0), (1200, 2000, 3)]


def test_parse_valid_frame_no_target():
    assert parse_frame(make_frame([(0, 0, 0)])) == []


def test_parse_invalid_header_returns_empty():
    bad = bytes([0x00] * 4) + bytes(24) + FRAME_FOOTER
    assert parse_frame(bad) == []


def test_parse_invalid_footer_returns_empty():
    bad = FRAME_HEADER + bytes(24) + bytes([0x00, 0x00])
    assert parse_frame(bad) == []


def test_parse_wrong_length_returns_empty():
    assert parse_frame(FRAME_HEADER + bytes(24)) == []


def test_parse_frame_too_short_returns_empty():
    targets = parse_frame(bytes([0xFD, 0xFC]))
    assert targets == []


def test_calculate_distance():
    assert calculate_distance(0, 1000) == pytest.approx(1000.0)
    assert calculate_distance(500, 866) == pytest.approx(1000.0, abs=1.0)


def test_calculate_distance_zero():
    assert calculate_distance(0, 0) == 0.0


from features.radar.daemon import PresenceTracker, clean_targets, TargetSmoother


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


# --- entry debounce -----------------------------------------------------

def test_debounce_requires_consecutive_frames():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=120,
                              enter_consecutive=3)
    assert tracker.update([(200, 1000, 0)]) is None   # frame 1 — not yet
    assert tracker.update([(200, 1000, 0)]) is None   # frame 2 — not yet
    assert tracker.update([(200, 1000, 0)]) == 'PRESENT'  # frame 3 — fires


def test_debounce_resets_on_gap():
    tracker = PresenceTracker(x_mm=400, y_mm=1500, timeout_sec=120,
                              enter_consecutive=3)
    tracker.update([(200, 1000, 0)])          # streak 1
    tracker.update([])                         # ghost gone -> streak reset
    assert tracker.update([(200, 1000, 0)]) is None   # streak 1 again, no fire


# --- target cleaning ----------------------------------------------------

def test_clean_targets_drops_origin_and_far():
    targets = [(0, 0, 0), (200, 1000, 5), (100, 9000, 5)]
    assert clean_targets(targets, max_range_mm=6000) == [(200, 1000, 5)]


def test_clean_targets_min_speed():
    targets = [(200, 1000, 2), (200, 1000, 20)]
    assert clean_targets(targets, min_speed=10) == [(200, 1000, 20)]


# --- target smoothing (EMA + deadband) ----------------------------------

def test_smoother_first_target_passes_through():
    s = TargetSmoother(alpha=0.5, deadband_mm=50, gate_mm=600)
    assert s.update([(200, 1000, 0)]) == [(200, 1000, 0)]


def test_smoother_ema_pulls_partway():
    s = TargetSmoother(alpha=0.5, deadband_mm=50, gate_mm=600)
    s.update([(200, 1000, 0)])                 # track at (200,1000)
    out = s.update([(400, 1000, 0)])           # move 200mm -> EMA half-way
    assert out == [(300, 1000, 0)]             # 200 + 0.5*(400-200)


def test_smoother_deadband_holds_position():
    s = TargetSmoother(alpha=0.5, deadband_mm=50, gate_mm=600)
    s.update([(200, 1000, 0)])
    out = s.update([(230, 1000, 0)])           # 30mm move < 50mm deadband
    assert out == [(200, 1000, 0)]             # unchanged


def test_smoother_separate_tracks_beyond_gate():
    s = TargetSmoother(alpha=0.5, deadband_mm=50, gate_mm=600)
    s.update([(200, 1000, 0)])
    out = s.update([(200, 1000, 0), (-1500, 1000, 0)])  # 2nd is far -> new track
    assert len(out) == 2


def test_smoother_drops_stale_track():
    s = TargetSmoother(alpha=0.5, deadband_mm=50, gate_mm=600, max_misses=2)
    s.update([(200, 1000, 0)])
    s.update([]); s.update([])                 # 2 misses -> still alive
    out = s.update([])                          # 3rd miss -> dropped
    assert out == []


# --- target-stream opt-in (RadarState.handle "stream") -------------------

def test_not_streaming_by_default():
    state = RadarState({})
    assert state.is_streaming(now=0.0) is False


def test_stream_active_enables_broadcasting():
    state = RadarState({})
    state.handle({"cmd": "stream", "active": True}, now=100.0)
    assert state.is_streaming(now=100.0) is True


def test_stream_defaults_to_active_true_when_omitted():
    state = RadarState({})
    state.handle({"cmd": "stream"}, now=100.0)
    assert state.is_streaming(now=100.0) is True


def test_stream_active_false_stops_broadcasting():
    state = RadarState({})
    state.handle({"cmd": "stream", "active": True}, now=100.0)
    state.handle({"cmd": "stream", "active": False}, now=101.0)
    assert state.is_streaming(now=101.0) is False


def test_stream_auto_expires_without_renewal():
    state = RadarState({})
    state.handle({"cmd": "stream", "active": True}, now=100.0)
    assert state.is_streaming(now=100.0 + STREAM_TIMEOUT_S - 1) is True
    assert state.is_streaming(now=100.0 + STREAM_TIMEOUT_S + 1) is False


def test_stream_renewal_pushes_the_deadline_out():
    state = RadarState({})
    state.handle({"cmd": "stream", "active": True}, now=100.0)
    state.handle({"cmd": "stream", "active": True}, now=100.0 + STREAM_TIMEOUT_S - 1)
    # Had it not renewed, this point would already be past the original deadline.
    assert state.is_streaming(now=100.0 + STREAM_TIMEOUT_S + 1) is True


def test_stream_command_does_not_mark_config_dirty():
    state = RadarState({"zone": {"x": 400, "y": 1500}})
    state.consume_dirty()  # clear the initial "publish once at startup" flag
    state.handle({"cmd": "stream", "active": True}, now=100.0)
    assert state.consume_dirty() is False


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
