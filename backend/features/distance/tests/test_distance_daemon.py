import pytest
from features.distance.daemon import (
    cm_from_echo, clean_reading, average_reading, PresenceTracker,
)
from features.distance import constants


def test_cm_from_echo_known_distance():
    # 1m round trip at 34300 cm/s = 2m / 34300 cm/s ≈ 0.005831s
    echo_s = (100 * 2) / constants.SPEED_OF_SOUND_CM_PER_S
    assert cm_from_echo(echo_s) == pytest.approx(100.0, abs=0.1)


def test_cm_from_echo_zero():
    assert cm_from_echo(0) == 0


def test_clean_reading_in_range():
    assert clean_reading(150.0, max_range_cm=400) == 150.0


def test_clean_reading_drops_zero_or_negative():
    assert clean_reading(0, max_range_cm=400) is None
    assert clean_reading(-5, max_range_cm=400) is None


def test_clean_reading_drops_beyond_max_range():
    assert clean_reading(450, max_range_cm=400) is None


def test_clean_reading_rounds_to_one_decimal():
    assert clean_reading(123.456, max_range_cm=400) == 123.5


def test_clean_reading_accepts_at_exact_max_range():
    assert clean_reading(400, max_range_cm=400) == 400.0


# --- averaging window ----------------------------------------------------

def test_average_reading_smooths_jitter():
    assert average_reading([90.0, 115.0, 92.0]) == pytest.approx(99.0, abs=0.1)


def test_average_reading_single_sample_is_unchanged():
    assert average_reading([123.4]) == 123.4


def test_average_reading_ignores_dropped_pings():
    # None entries are pings that failed clean_reading (echo timeout, out of
    # range) — they must not drag the average toward zero.
    assert average_reading([100.0, None, 102.0, None]) == 101.0


def test_average_reading_all_dropped_is_none():
    assert average_reading([None, None, None]) is None


def test_average_reading_empty_window_is_none():
    assert average_reading([]) is None


# --- presence tracker ------------------------------------------------------

def test_present_fires_immediately_on_near_reading():
    t = PresenceTracker(warn_cm=30, absent_after_n=3)
    assert t.update(20.0) == "PRESENT"
    assert t.is_present is True


def test_no_repeat_present_while_still_near():
    t = PresenceTracker(warn_cm=30, absent_after_n=3)
    t.update(20.0)              # PRESENT
    assert t.update(25.0) is None


def test_absent_requires_n_consecutive_far_readings():
    t = PresenceTracker(warn_cm=30, absent_after_n=3)
    t.update(20.0)                    # PRESENT
    assert t.update(40.0) is None     # far #1
    assert t.update(45.0) is None     # far #2
    assert t.update(50.0) == "ABSENT"  # far #3 -> fires


def test_far_streak_resets_on_a_near_reading_in_between():
    # Matches the example: 95, 40, 20, 35, 40, 45 with warn_cm=30,
    # absent_after_n=3 -> the 20 resets the streak, so 35/40/45 are the
    # three-in-a-row that finally fire ABSENT.
    t = PresenceTracker(warn_cm=30, absent_after_n=3)
    assert t.update(95.0) is None      # far #1, never present yet
    assert t.update(40.0) is None      # far #2
    assert t.update(20.0) == "PRESENT"  # near -> resets streak, fires PRESENT
    assert t.update(35.0) is None      # far #1
    assert t.update(40.0) is None      # far #2
    assert t.update(45.0) == "ABSENT"  # far #3 -> fires


def test_no_repeat_absent_after_already_absent():
    t = PresenceTracker(warn_cm=30, absent_after_n=2)
    t.update(20.0)             # PRESENT
    t.update(40.0)             # far #1
    assert t.update(40.0) == "ABSENT"  # far #2 -> fires
    assert t.update(40.0) is None       # still absent, no repeat event


def test_missing_echo_counts_as_far():
    t = PresenceTracker(warn_cm=30, absent_after_n=2)
    t.update(20.0)              # PRESENT
    t.update(None)              # far #1 (no echo)
    assert t.update(None) == "ABSENT"  # far #2 -> fires


def test_absent_after_n_of_one_fires_on_first_far_reading():
    t = PresenceTracker(warn_cm=30, absent_after_n=1)
    t.update(20.0)              # PRESENT
    assert t.update(40.0) == "ABSENT"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
