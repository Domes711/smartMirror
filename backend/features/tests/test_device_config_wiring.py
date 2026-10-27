"""The hardware config tables are actually read by the code.

Without these the tables would be decoration: the daemons would keep using
their constants and nobody would notice until someone changed a value in the
DB and nothing happened.
"""

import pytest

from data import device_config, profiles as profiles_data


# --------------------------------------------------------------------------- #
# camera: resolution / tolerance / rotation come from camera_config
# --------------------------------------------------------------------------- #
def test_supervisor_reads_resolution_and_tolerance_from_db(sandbox):
    from features.camera import supervisor
    device_config.set_many("camera", {
        "resolution_width": 1280, "resolution_height": 720,
        "recognition_tolerance": 0.42})
    sup = supervisor.Supervisor()
    assert (sup.width, sup.height) == (1280, 720)
    assert sup.tolerance == 0.42


def test_explicit_arguments_still_win_over_the_db(sandbox):
    """service.py passes CLI flags; those must override the stored values."""
    from features.camera import supervisor
    device_config.set_many("camera", {"resolution_width": 1280,
                                      "resolution_height": 720})
    sup = supervisor.Supervisor(width=640, height=480)
    assert (sup.width, sup.height) == (640, 480)


def test_rotation_defaults_to_180_because_the_camera_is_upside_down(sandbox):
    from features.camera import supervisor
    assert supervisor.Supervisor().rotation == 180


def test_rotation_is_configurable_not_pinned(sandbox):
    """Remounting the camera is a config change, not a code change."""
    from features.camera import supervisor
    device_config.set_value("camera", "rotation", 0)
    assert supervisor.Supervisor().rotation == 0


def test_supervisor_still_starts_when_the_config_is_unreadable(sandbox,
                                                               monkeypatch):
    """A broken DB must not stop the camera serving a stream."""
    from features.camera import supervisor
    monkeypatch.setattr(device_config, "resolve",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError))
    sup = supervisor.Supervisor()
    assert (sup.width, sup.height) == (supervisor.DEFAULT_WIDTH,
                                       supervisor.DEFAULT_HEIGHT)


def test_recognition_daemon_reads_timeout_and_tolerance(sandbox):
    from features.camera import recognition_daemon as daemon
    device_config.set_many("camera", {"recognition_timeout_s": 5.0,
                                      "recognition_tolerance": 0.33})
    cfg = daemon._config_defaults()
    assert cfg["max_duration"] == 5.0
    assert cfg["tolerance"] == 0.33


def test_recognition_daemon_falls_back_to_constants(sandbox, monkeypatch):
    from features.camera import recognition_daemon as daemon
    monkeypatch.setattr(device_config, "resolve",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError))
    cfg = daemon._config_defaults()
    assert cfg["max_duration"] == daemon.DEFAULT_MAX_DURATION
    assert cfg["tolerance"] == daemon.DEFAULT_TOLERANCE


# --------------------------------------------------------------------------- #
# radar: config.py goes through device_config now
# --------------------------------------------------------------------------- #
def test_radar_config_round_trips_through_device_config(sandbox):
    from features.radar import config
    config.save({"zone": {"x": 500, "y": 2000}, "enter_frames": 7})
    assert config.load()["zone"] == {"x": 500, "y": 2000}
    assert config.load()["enter_frames"] == 7
    # Keys never written still have the in-code default.
    assert config.load()["alpha"] == config.DEFAULTS["alpha"]


def test_radar_unknown_key_is_refused(sandbox):
    from features.radar import config
    with pytest.raises(ValueError):
        config.set_key("not_a_radar_key", 1)


def test_radar_config_can_be_overridden_per_profile(sandbox):
    from features.radar import config
    profiles_data.ensure("dominik")
    config.save({"enter_frames": 3})
    config.save({"enter_frames": 9}, profile="dominik")
    assert config.load()["enter_frames"] == 3
    assert config.load("dominik")["enter_frames"] == 9


# --------------------------------------------------------------------------- #
# monitor: display.service resolves monitor_config and applies it to the HW
# --------------------------------------------------------------------------- #
def test_apply_profile_resolves_defaults_overlaid_with_overrides(sandbox,
                                                                  monkeypatch):
    from features.display import service as display_service
    monkeypatch.setattr(display_service.driver, "ddcutil_setvcp",
                        lambda *a, **k: True)
    profiles_data.ensure("dominik")
    device_config.set_value("monitor", "brightness_day", 42, profile="dominik")
    cfg = display_service.apply_profile("dominik")
    assert cfg["brightness_day"] == 42          # overridden
    assert cfg["sleep_timeout_s"] == device_config.resolve(
        "monitor", "default")["sleep_timeout_s"]  # still the default


def test_apply_profile_for_a_profile_with_no_overrides_is_the_default(
        sandbox, monkeypatch):
    from features.display import service as display_service
    monkeypatch.setattr(display_service.driver, "ddcutil_setvcp",
                        lambda *a, **k: True)
    profiles_data.ensure("nobody_special")
    cfg = display_service.apply_profile("nobody_special")
    assert cfg == device_config.resolve("monitor", "default")


def test_apply_profile_pushes_hw_applicable_keys_onto_the_driver(sandbox,
                                                                  monkeypatch):
    from features.display import service as display_service
    calls = []
    monkeypatch.setattr(display_service.driver, "ddcutil_setvcp",
                        lambda feature, value, **k: calls.append((feature, value)) or True)
    device_config.set_value("monitor", "brightness_day", 55)
    display_service.apply_profile("default")
    assert (display_service.driver.VCP_BRIGHTNESS, "55") in calls
