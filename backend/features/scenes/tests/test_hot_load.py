"""Hot-load over MQTT (`smartmirror/core/hot-load`).

This replaced an HTTP POST to the MagicMirror core. The failure direction is
what matters: a hot-load that is not confirmed must report failure so
`apply_layout` falls back to a pm2 restart. A silent success would leave the
module never loaded on the mirror — the exact class of bug that already bit
this feature once (the config.js injection that reverted itself).
"""

import threading

import pytest

from features.scenes import mqtt as topics, rpc


@pytest.fixture
def core(monkeypatch, sandbox):
    """A stand-in MagicMirror core, plus a fast timeout so the no-reply case
    does not cost 15 s per test."""
    from features.modules import catalog
    catalog.seed_builtins()
    monkeypatch.setattr(rpc, "HOT_LOAD_TIMEOUT", 1.0)

    # Reset the module-level registry between tests.
    monkeypatch.setattr(rpc, "_hot_load_waiters", {})
    monkeypatch.setattr(rpc, "_hot_load_lock", threading.Lock())
    monkeypatch.setattr(rpc, "_hot_load_subscribed", False)

    state = {"answer": True, "ok": True, "requests": [], "subscriptions": 0}

    class FakeClient:
        def subscribe(self, topic, callback, qos=1):
            if topic == topics.HOT_LOAD_RESULT:
                state["subscriptions"] += 1
                state["on_result"] = callback

        def publish(self, topic, payload, retain=False, qos=1):
            if topic != topics.HOT_LOAD:
                return
            state["requests"].append(payload)
            if not state["answer"]:
                return
            import json
            state["on_result"](topics.HOT_LOAD_RESULT, json.dumps({
                "moduleId": payload["moduleId"],
                "moduleName": payload["moduleName"],
                "ok": state["ok"],
            }))

    monkeypatch.setattr(rpc, "client", lambda: FakeClient())
    return state


INSTANCES = [{"id": "clock-1", "type": "clock", "values": {}},
             {"id": "clock-2", "type": "clock", "values": {}}]


def test_confirmed_hot_load_reports_success(core):
    assert rpc._hot_load(INSTANCES) == {"ok": True, "failed": []}
    assert len(core["requests"]) == 2
    assert {"moduleName", "moduleId", "moduleConfig"} <= set(core["requests"][0])


def test_core_rejection_is_reported_so_the_caller_restarts(core):
    core["ok"] = False
    result = rpc._hot_load([INSTANCES[0]])
    assert result["ok"] is False
    assert result["failed"] == ["clock"]


def test_no_reply_fails_instead_of_silently_succeeding(core):
    """The dangerous case: an unresponsive core must not look like success."""
    core["answer"] = False
    result = rpc._hot_load([INSTANCES[0]])
    assert result["ok"] is False
    assert result["failed"] == ["clock"]


def test_nothing_to_load_publishes_nothing(core):
    assert rpc._hot_load([]) == {"ok": True, "failed": []}
    assert rpc._hot_load([{"type": "clock"}]) == {"ok": True, "failed": []}
    assert core["requests"] == []


def test_repeated_applies_do_not_stack_up_result_handlers(core):
    """One subscription for the lifetime of the process: subscribing per call
    left a stale handler behind on every Apply, each still firing on later
    replies."""
    for _ in range(3):
        rpc._hot_load([INSTANCES[0]])
    assert core["subscriptions"] == 1


def test_waiters_are_cleaned_up_after_each_call(core):
    rpc._hot_load(INSTANCES)
    assert rpc._hot_load_waiters == {}
    core["answer"] = False
    rpc._hot_load([INSTANCES[0]])
    assert rpc._hot_load_waiters == {}
