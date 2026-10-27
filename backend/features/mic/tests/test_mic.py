"""Mic: config persistence, satellite service arbitration, test recording."""

import pytest


# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #
def test_defaults_when_nothing_stored(sandbox):
    from features.mic import config
    cfg = config.load()
    assert cfg == config.DEFAULTS
    # A fresh dict each call — a caller mutating it must not poison defaults.
    cfg["device"] = "poisoned"
    assert config.load()["device"] == config.DEFAULTS["device"]


def test_save_then_load_round_trip(sandbox):
    from features.mic import config
    config.save({"device": "plughw:1,0", "input_gain": 60})
    cfg = config.load()
    assert cfg["device"] == "plughw:1,0"
    assert cfg["input_gain"] == 60
    # Untouched keys keep their defaults.
    assert cfg["wake_word"] == config.DEFAULTS["wake_word"]


def test_unknown_keys_are_ignored(sandbox):
    from features.mic import config
    config.save({"device": "plughw:1,0", "nonsense": "drop me"})
    assert "nonsense" not in config.load()


def test_set_key_rejects_an_unknown_key(sandbox):
    from features.mic import config
    with pytest.raises(ValueError):
        config.set_key("nope", 1)


# --------------------------------------------------------------------------- #
# service: config_get/config_set
# --------------------------------------------------------------------------- #
def test_service_config_set_rejects_an_unknown_key(sandbox):
    from features.mic import service
    with pytest.raises(ValueError, match="unknown mic config key"):
        service.config_set({"nope": 1})


def test_service_config_set_round_trips_known_keys(sandbox, monkeypatch):
    from features.mic import service
    monkeypatch.setattr(service, "_apply_satellite_unit", lambda *a: None)
    cfg = service.config_set({"satellite_name": "Koupelna"})
    assert cfg["satellite_name"] == "Koupelna"
    assert service.config_get()["satellite_name"] == "Koupelna"


def test_service_config_set_applies_input_gain(sandbox, monkeypatch):
    from features.mic import service
    calls = []
    monkeypatch.setattr(service, "_apply_input_gain",
                        lambda device, percent: calls.append((device, percent)))
    service.config_set({"input_gain": 42})
    assert calls == [(service.config.DEFAULTS["device"], 42)]


# --------------------------------------------------------------------------- #
# satellite unit regeneration on a unit-affecting config change
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("key, value", [
    ("device", "plughw:1,0"), ("satellite_name", "Koupelna"),
    ("wake_word", "hey_jarvis"),
])
def test_config_set_regenerates_the_unit_for_each_affecting_key(
        sandbox, monkeypatch, key, value):
    from features.mic import service
    calls = []
    monkeypatch.setattr(service, "_apply_satellite_unit",
                        lambda cfg: calls.append(cfg))
    service.config_set({key: value})
    assert len(calls) == 1 and calls[0][key] == value


def test_config_set_does_not_touch_the_unit_for_input_gain_alone(
        sandbox, monkeypatch):
    """input_gain is a live amixer call, not a unit file field — must not
    trigger a systemd regeneration + restart."""
    from features.mic import service
    monkeypatch.setattr(service, "_apply_input_gain", lambda *a: None)
    calls = []
    monkeypatch.setattr(service, "_apply_satellite_unit",
                        lambda cfg: calls.append(cfg))
    service.config_set({"input_gain": 50})
    assert calls == []


def test_apply_satellite_unit_calls_the_privileged_script_with_cfg_values(
        sandbox, monkeypatch):
    from features.mic import service
    from shared import systemctl
    calls = []
    monkeypatch.setattr(systemctl, "run_privileged_script",
                        lambda path, *args, **kw: calls.append((path, args)) or (0, ""))
    cfg = {"device": "plughw:1,0", "satellite_name": "Koupelna",
           "wake_word": "hey_jarvis"}
    service._apply_satellite_unit(cfg)
    assert calls == [(service.APPLY_SCRIPT,
                      ("plughw:1,0", "Koupelna", "hey_jarvis"))]


def test_apply_satellite_unit_failure_does_not_raise(sandbox, monkeypatch):
    """A config write must still succeed even if the sudoers rule or the
    satellite install is missing — e.g. before setup.sh has ever run."""
    from features.mic import service
    from shared import systemctl
    monkeypatch.setattr(systemctl, "run_privileged_script",
                        lambda *a, **kw: (1, "sudo: a password is required"))
    service._apply_satellite_unit(
        {"device": "default", "satellite_name": "x", "wake_word": "ok_nabu"})


# --------------------------------------------------------------------------- #
# satellite service control
# --------------------------------------------------------------------------- #
def test_service_status_reports_systemctl_state(sandbox, monkeypatch):
    from features.mic import service
    from shared import systemctl
    monkeypatch.setattr(systemctl, "is_active", lambda _n: True)
    monkeypatch.setattr(systemctl, "exists", lambda _n: True)
    assert service.service_status() == {"active": True, "available": True}


def test_service_set_calls_systemctl(sandbox, monkeypatch):
    from features.mic import service
    from shared import systemctl
    calls = []
    monkeypatch.setattr(systemctl, "run", lambda *a: calls.append(a))
    monkeypatch.setattr(systemctl, "is_active", lambda _n: False)
    monkeypatch.setattr(systemctl, "exists", lambda _n: True)
    result = service.service_set(True)
    assert calls == [("start", service.SERVICE_NAME)]
    assert result == {"active": False, "available": True}


# --------------------------------------------------------------------------- #
# test recording
# --------------------------------------------------------------------------- #
def test_recording_rejects_out_of_range_seconds(sandbox):
    from features.mic import service
    with pytest.raises(ValueError):
        service.test_recording(0)
    with pytest.raises(ValueError):
        service.test_recording(service.MAX_TEST_SECONDS + 1)


def test_recording_stops_and_restarts_the_satellite(sandbox, monkeypatch):
    """A test recording must release the satellite's hold on the mic, then
    hand it back — whether or not it was running."""
    from features.mic import service
    from shared import systemctl

    systemctl_calls = []
    monkeypatch.setattr(systemctl, "run",
                        lambda action, name: systemctl_calls.append((action, name)))
    monkeypatch.setattr(systemctl, "is_active", lambda _n: True)
    monkeypatch.setattr(service.time, "sleep", lambda _s: None)

    subprocess_calls = []

    class FakeResult:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **kwargs):
        subprocess_calls.append(cmd)
        return FakeResult()

    monkeypatch.setattr(service.subprocess, "run", fake_run)

    result = service.test_recording(3)
    assert result["ok"] is True
    assert systemctl_calls == [("stop", service.SERVICE_NAME),
                               ("start", service.SERVICE_NAME)]
    assert subprocess_calls[0][0] == "arecord"


def test_recording_restarts_the_satellite_even_if_arecord_fails(sandbox, monkeypatch):
    from features.mic import service
    from shared import systemctl

    systemctl_calls = []
    monkeypatch.setattr(systemctl, "run",
                        lambda action, name: systemctl_calls.append((action, name)))
    monkeypatch.setattr(systemctl, "is_active", lambda _n: True)
    monkeypatch.setattr(service.time, "sleep", lambda _s: None)

    class FailingResult:
        returncode = 1
        stderr = "device busy"

    monkeypatch.setattr(service.subprocess, "run",
                        lambda cmd, **kwargs: FailingResult())

    with pytest.raises(RuntimeError, match="arecord failed"):
        service.test_recording(3)
    assert systemctl_calls == [("stop", service.SERVICE_NAME),
                               ("start", service.SERVICE_NAME)]


def test_recording_does_not_touch_the_satellite_when_already_stopped(
        sandbox, monkeypatch):
    from features.mic import service
    from shared import systemctl

    systemctl_calls = []
    monkeypatch.setattr(systemctl, "run",
                        lambda action, name: systemctl_calls.append((action, name)))
    monkeypatch.setattr(systemctl, "is_active", lambda _n: False)

    class FakeResult:
        returncode = 0
        stderr = ""

    monkeypatch.setattr(service.subprocess, "run",
                        lambda cmd, **kwargs: FakeResult())

    service.test_recording(3)
    assert systemctl_calls == []
