"""Radar calibration persisted in SQLite."""


import pytest


def test_defaults_when_nothing_stored(sandbox):
    from features.radar import config
    cfg = config.load()
    assert cfg == config.DEFAULTS
    # A fresh dict each call — a caller mutating it must not poison defaults.
    cfg["x_offset"] = 999
    assert config.load()["x_offset"] == 0


def test_save_then_load_round_trip(sandbox):
    from features.radar import config
    config.save({"x_offset": 120, "invert_x": True,
                 "zone": {"x": 500, "y": 2000},
                 "exclusions": [[10, 20], [30, 40]]})
    cfg = config.load()
    assert cfg["x_offset"] == 120
    assert cfg["invert_x"] is True
    assert cfg["zone"] == {"x": 500, "y": 2000}
    assert cfg["exclusions"] == [[10, 20], [30, 40]]
    # Untouched keys keep their defaults.
    assert cfg["alpha"] == config.DEFAULTS["alpha"]


def test_a_partial_save_does_not_clear_other_keys(sandbox):
    """Key-value rows, not one blob: the daemon saving learned ghost spots
    must not stomp a zone the app wrote a moment earlier."""
    from features.radar import config
    config.save({"zone": {"x": 500, "y": 2000}})
    config.save({"exclusions": [[1, 2]]})
    cfg = config.load()
    assert cfg["zone"] == {"x": 500, "y": 2000}
    assert cfg["exclusions"] == [[1, 2]]


def test_unknown_keys_are_ignored(sandbox):
    from features.radar import config
    config.save({"x_offset": 5, "nonsense": "drop me"})
    assert "nonsense" not in config.load()


def test_set_key_rejects_an_unknown_key(sandbox):
    from features.radar import config
    with pytest.raises(ValueError):
        config.set_key("nope", 1)


def test_daemon_defaults_match_the_config_module(sandbox):
    """daemon.py duplicates the defaults as plain data so the parser tests
    stay import-light. They must not drift apart."""
    from features.radar import config, daemon
    assert daemon.DEFAULT_CONFIG == config.DEFAULTS
    assert set(daemon._CONFIG_KEYS) == set(config.KEYS)
