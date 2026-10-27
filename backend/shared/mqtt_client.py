"""Shared paho-mqtt wrapper: connect with retry, publish, subscribe.

Every feature gets a broker connection through here instead of hand-rolling
`paho.mqtt.Client` + reconnect logic (which the three daemons each did
slightly differently). Subscriptions are re-applied on every reconnect, so a
broker restart does not silently leave a daemon deaf.
"""

import json
import logging
import os
import threading

import paho.mqtt.client as mqtt

BROKER = os.environ.get("MQTT_BROKER", "127.0.0.1")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
KEEPALIVE = int(os.environ.get("MQTT_KEEPALIVE", "60"))

log = logging.getLogger("mqtt")


class MqttClient:
    """Thin wrapper over paho. `start()` is non-blocking (background loop)."""

    def __init__(self, client_id: str, broker: str = BROKER, port: int = PORT):
        self.client_id = client_id
        self.broker = broker
        self.port = port
        self._handlers = {}        # topic filter -> [callback]
        self._lock = threading.Lock()
        self.connected = False
        self._client = mqtt.Client(client_id=client_id)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        # paho retries forever with backoff; the daemons must survive a broker
        # that comes up after them (systemd ordering is not a guarantee).
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)

    # ---- lifecycle ----------------------------------------------------- #
    def start(self) -> "MqttClient":
        try:
            self._client.connect_async(self.broker, self.port, KEEPALIVE)
        except Exception as exc:  # noqa: BLE001
            log.warning("%s: initial connect failed (%s) — will retry",
                        self.client_id, exc)
        self._client.loop_start()
        return self

    def stop(self) -> None:
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    # ---- pub/sub -------------------------------------------------------- #
    def publish(self, topic: str, payload, retain: bool = False, qos: int = 1):
        if not isinstance(payload, (str, bytes)):
            payload = json.dumps(payload, ensure_ascii=False)
        try:
            return self._client.publish(topic, payload, qos=qos, retain=retain)
        except Exception as exc:  # noqa: BLE001
            log.warning("publish %s failed: %s", topic, exc)
            return None

    def subscribe(self, topic: str, callback, qos: int = 1) -> None:
        """Register `callback(topic, payload_str)`. Applied now if connected,
        and re-applied automatically after any reconnect."""
        with self._lock:
            self._handlers.setdefault(topic, []).append(callback)
        if self.connected:
            self._client.subscribe(topic, qos)

    # ---- paho callbacks -------------------------------------------------- #
    def _on_connect(self, _c, _u, _f, rc):
        if rc != 0:
            log.warning("%s: connect refused rc=%s", self.client_id, rc)
            return
        self.connected = True
        log.info("%s: connected to %s:%d", self.client_id, self.broker, self.port)
        with self._lock:
            topics = list(self._handlers)
        for t in topics:
            self._client.subscribe(t, 1)

    def _on_disconnect(self, _c, _u, rc):
        self.connected = False
        if rc != 0:
            log.warning("%s: unexpected disconnect rc=%s — reconnecting",
                        self.client_id, rc)

    def _on_message(self, _c, _u, msg):
        payload = msg.payload.decode("utf-8", "replace")
        with self._lock:
            handlers = [cb for filt, cbs in self._handlers.items()
                        if mqtt.topic_matches_sub(filt, msg.topic)
                        for cb in cbs]
        for cb in handlers:
            try:
                cb(msg.topic, payload)
            except Exception:  # noqa: BLE001
                log.exception("handler for %s raised", msg.topic)

    # ---- request / reply ------------------------------------------------- #
    def serve(self, topic: str, handler, qos: int = 1) -> None:
        """Expose `handler(payload_dict) -> dict` as an MQTT RPC endpoint.

        The wire contract mirrors MQTT 5's response-topic pattern, but is
        carried in the *payload* so it works on a v3.1.1 broker (mosquitto
        here) and with paho's v1 API:

            request  → `topic`            {"_rid": …, "_reply": …, <args>}
            response → `payload["_reply"]` {"_rid": …, "ok": true, …result}
                                           {"_rid": …, "ok": false,
                                            "error": msg, "status": code}

        `_rid` lets one caller have several requests in flight on a single
        reply topic; `status` carries the HTTP status the same route used, so
        callers that distinguish 404 from 409 (the AI builder's finalize
        does) keep working.

        Handlers run on the paho network thread, so a slow handler would
        block every other subscription on this client. Each request therefore
        gets its own short-lived thread.
        """

        def on_request(_topic: str, payload: str) -> None:
            try:
                req = json.loads(payload or "{}")
                if not isinstance(req, dict):
                    req = {}
            except Exception:  # noqa: BLE001
                log.warning("rpc %s: payload is not JSON", topic)
                return

            reply_to, rid = req.get("_reply"), req.get("_rid")

            def run() -> None:
                try:
                    result = handler(req)
                    body = {"ok": True}
                    if isinstance(result, dict):
                        body.update(result)
                    elif result is not None:
                        body["result"] = result
                except Exception as exc:  # noqa: BLE001
                    status = getattr(exc, "status", 500)
                    body = {"ok": False, "error": str(exc), "status": status}
                    # A declared status (404/409/…) is a normal outcome, not a
                    # bug — log it as one line, keep tracebacks for crashes.
                    if status == 500:
                        log.exception("rpc %s failed", topic)
                    else:
                        log.info("rpc %s → %d: %s", topic, status, exc)
                if not reply_to:
                    return          # fire-and-forget caller, nothing to answer
                if rid is not None:
                    body["_rid"] = rid
                self.publish(reply_to, body, qos=qos)

            threading.Thread(target=run, daemon=True).start()

        self.subscribe(topic, on_request, qos)
