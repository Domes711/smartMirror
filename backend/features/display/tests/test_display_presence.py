"""DisplayMqtt._on_presence: GLOBAL_PRESENCE wakes immediately, but only
*schedules* standby — off_delay_s later, cancellable by a "present" that
arrives first.

service.set_power / service.get_off_delay_s are monkeypatched so these tests
exercise only mqtt.py's orchestration, not real ddcutil subprocess calls or
a real wait — the delay itself is driven by a fake Timer that fires
synchronously on `.start()` instead of after a real clock delay.
"""

import pytest


class FakeClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload, retain=False, qos=1):
        self.published.append((topic, payload))


class ImmediateTimer:
    """Stands in for threading.Timer: records whether it was cancelled, and
    only invokes its function if .start() is called without a prior
    .cancel() — the test drives firing explicitly via `run()` instead of
    sleeping for the real delay."""

    instances = []

    def __init__(self, interval, function):
        self.interval = interval
        self.function = function
        self.cancelled = False
        self.started = False
        ImmediateTimer.instances.append(self)

    def cancel(self):
        self.cancelled = True

    def start(self):
        self.started = True

    def run(self):
        if not self.cancelled:
            self.function()


@pytest.fixture(autouse=True)
def _reset_fake_timers():
    ImmediateTimer.instances.clear()
    yield
    ImmediateTimer.instances.clear()


def _make_handler(monkeypatch, off_delay_s=30):
    from features.display import mqtt as display_mqtt
    from features.display import service

    monkeypatch.setattr(display_mqtt, "threading", type(
        "FakeThreadingModule", (), {"Timer": ImmediateTimer}))
    monkeypatch.setattr(service, "get_off_delay_s", lambda profile="default": off_delay_s)
    monkeypatch.setattr(service, "get_monitor_state", lambda: {})

    power_calls = []
    monkeypatch.setattr(service, "set_power", lambda mode: power_calls.append(mode) or True)

    client = FakeClient()
    handler = display_mqtt.DisplayMqtt(client)
    return handler, power_calls, client


def test_present_wakes_immediately(monkeypatch):
    handler, power_calls, _client = _make_handler(monkeypatch)
    handler.on_message("smartmirror/global/presence", "present")
    assert power_calls == ["on"]


def test_absent_schedules_a_timer_instead_of_standing_by_immediately(monkeypatch):
    handler, power_calls, _client = _make_handler(monkeypatch, off_delay_s=45)
    handler.on_message("smartmirror/global/presence", "absent")
    assert power_calls == []  # not yet — only scheduled
    assert len(ImmediateTimer.instances) == 1
    assert ImmediateTimer.instances[0].interval == 45
    assert ImmediateTimer.instances[0].started is True


def test_absent_timer_firing_stands_by(monkeypatch):
    handler, power_calls, _client = _make_handler(monkeypatch)
    handler.on_message("smartmirror/global/presence", "absent")
    ImmediateTimer.instances[0].run()
    assert power_calls == ["standby"]


def test_present_before_timer_fires_cancels_standby(monkeypatch):
    handler, power_calls, _client = _make_handler(monkeypatch)
    handler.on_message("smartmirror/global/presence", "absent")
    handler.on_message("smartmirror/global/presence", "present")
    assert ImmediateTimer.instances[0].cancelled is True
    # The pending standby never fires even if someone still calls it.
    ImmediateTimer.instances[0].run()
    assert power_calls == ["on"]


def test_a_second_absent_cancels_the_first_pending_timer(monkeypatch):
    handler, _power_calls, _client = _make_handler(monkeypatch)
    handler.on_message("smartmirror/global/presence", "absent")
    first = ImmediateTimer.instances[0]
    handler.on_message("smartmirror/global/presence", "absent")
    assert first.cancelled is True
    assert len(ImmediateTimer.instances) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
