"""MqttClient.serve — the request/reply layer every feature's API sits on.

No broker here: the suite must run on a laptop with no mosquitto (and the Pi's
hardware absent), so these tests drive `MqttClient`'s paho callbacks directly.
That is enough, because `serve()`'s whole contract lives between `_on_message`
and `publish` — decode the envelope, run the handler off the network thread,
publish the reply to `_reply` keyed by `_rid`.
"""

import json
import threading

import pytest

from shared.http import HttpError
from shared.mqtt_client import MqttClient


class FakeClient:
    """Stands in for `MqttClient`: records publishes, fakes deliveries."""

    def __init__(self):
        self.client = MqttClient("test")
        self.client.connected = True
        self.published = []
        self.client._client.publish = self._publish

    def _publish(self, topic, payload, qos=1, retain=False):
        self.published.append((topic, json.loads(payload)))
        return None

    def deliver(self, topic: str, payload) -> None:
        """Feed one inbound message through paho's on_message path."""
        if not isinstance(payload, (str, bytes)):
            payload = json.dumps(payload)

        class Msg:
            pass

        msg = Msg()
        msg.topic = topic
        msg.payload = payload.encode() if isinstance(payload, str) else payload
        self.client._on_message(None, None, msg)

    def reply_for(self, rid, timeout=5.0):
        """Wait for the reply carrying `_rid == rid`."""
        end = threading.Event()
        import time
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for _topic, body in list(self.published):
                if body.get("_rid") == rid:
                    return body
            end.wait(0.02)
        return None


@pytest.fixture
def fake():
    return FakeClient()


def test_handler_result_is_published_to_the_reply_topic(fake):
    fake.client.serve("t/echo", lambda req: {"got": req.get("v")})
    fake.deliver("t/echo", {"_rid": "r1", "_reply": "t/back", "v": 42})

    reply = fake.reply_for("r1")
    assert reply == {"ok": True, "got": 42, "_rid": "r1"}
    assert fake.published[0][0] == "t/back"


def test_http_error_status_survives_onto_the_reply(fake):
    """The app distinguishes 404/409 from a crash — finalize's overwrite
    prompt depends on it, so the status must cross the wire."""
    def busy(_req):
        raise HttpError(409, "agent zrovna pracuje")

    fake.client.serve("t/busy", busy)
    fake.deliver("t/busy", {"_rid": "r2", "_reply": "t/back"})

    reply = fake.reply_for("r2")
    assert reply["ok"] is False
    assert reply["status"] == 409
    assert "zrovna pracuje" in reply["error"]


def test_unexpected_exception_becomes_a_500_reply_not_a_hang(fake):
    def boom(_req):
        raise RuntimeError("kaboom")

    fake.client.serve("t/boom", boom)
    fake.deliver("t/boom", {"_rid": "r3", "_reply": "t/back"})

    reply = fake.reply_for("r3")
    assert reply["ok"] is False and reply["status"] == 500
    assert "kaboom" in reply["error"]


def test_a_slow_handler_does_not_block_the_next_request(fake):
    """Handlers must not run on the paho network thread: one slow call would
    stall every other subscription on the same client."""
    release = threading.Event()

    def slow(_req):
        release.wait(5)
        return {"slow": True}

    fake.client.serve("t/slow", slow)
    fake.client.serve("t/fast", lambda _req: {"fast": True})

    fake.deliver("t/slow", {"_rid": "slow", "_reply": "t/back"})
    fake.deliver("t/fast", {"_rid": "fast", "_reply": "t/back"})

    assert fake.reply_for("fast", timeout=2) == {"ok": True, "fast": True,
                                                 "_rid": "fast"}
    release.set()
    assert fake.reply_for("slow") is not None


def test_request_without_reply_topic_still_runs_the_handler(fake):
    """Fire-and-forget commands (the app's dev screen publishes some) must
    execute, and must not try to answer."""
    ran = threading.Event()
    fake.client.serve("t/ff", lambda _req: ran.set() or {"ok": True})

    fake.deliver("t/ff", {"just": "do it"})

    assert ran.wait(2)
    assert fake.published == []


def test_malformed_payload_is_ignored_and_the_endpoint_keeps_working(fake):
    calls = []
    fake.client.serve("t/echo", lambda req: calls.append(req) or {"n": len(calls)})

    fake.deliver("t/echo", "not json{{")
    fake.deliver("t/echo", {"_rid": "after", "_reply": "t/back"})

    assert fake.reply_for("after") is not None
    assert len(calls) == 1          # the garbage never reached the handler


def test_concurrent_requests_are_matched_by_rid(fake):
    """One caller, one reply topic, several requests in flight."""
    gates = {name: threading.Event() for name in ("a", "b")}

    def handler(req):
        gates[req["which"]].wait(5)
        return {"which": req["which"]}

    fake.client.serve("t/multi", handler)
    fake.deliver("t/multi", {"_rid": "ra", "_reply": "t/back", "which": "a"})
    fake.deliver("t/multi", {"_rid": "rb", "_reply": "t/back", "which": "b"})

    # Answer out of order: b first.
    gates["b"].set()
    assert fake.reply_for("rb")["which"] == "b"
    gates["a"].set()
    assert fake.reply_for("ra")["which"] == "a"


def test_non_dict_handler_result_is_wrapped(fake):
    fake.client.serve("t/scalar", lambda _req: ["a", "b"])
    fake.deliver("t/scalar", {"_rid": "r9", "_reply": "t/back"})

    assert fake.reply_for("r9") == {"ok": True, "result": ["a", "b"],
                                    "_rid": "r9"}
