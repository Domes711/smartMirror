"""Display: the off_delay_s config round trip and its range validation.

driver.py (ddcutil subprocess calls) is not exercised here — these tests
only cover the monitor_config-backed off_delay_s getter/setter, same as the
radar/mic config tests cover their own DB-backed settings.
"""

import pytest


def test_off_delay_defaults_to_the_minimum(sandbox):
    from features.display import service
    assert service.get_off_delay_s() == service.OFF_DELAY_MIN_S


def test_off_delay_save_then_load_round_trip(sandbox):
    from features.display import service
    assert service.set_off_delay_s(90) is True
    assert service.get_off_delay_s() == 90


def test_off_delay_rejects_below_minimum(sandbox):
    from features.display import service
    assert service.set_off_delay_s(service.OFF_DELAY_MIN_S - 1) is False
    assert service.get_off_delay_s() == service.OFF_DELAY_MIN_S


def test_off_delay_rejects_above_maximum(sandbox):
    from features.display import service
    assert service.set_off_delay_s(service.OFF_DELAY_MAX_S + 1) is False
    assert service.get_off_delay_s() == service.OFF_DELAY_MIN_S


def test_off_delay_accepts_the_exact_bounds(sandbox):
    from features.display import service
    assert service.set_off_delay_s(service.OFF_DELAY_MIN_S) is True
    assert service.set_off_delay_s(service.OFF_DELAY_MAX_S) is True
    assert service.get_off_delay_s() == service.OFF_DELAY_MAX_S


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
