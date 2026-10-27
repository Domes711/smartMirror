"""Broker connection and RPC dispatch for the camera feature.

**MQTT is the primary transport.** Every JSON operation is an RPC endpoint
(`shared.mqtt_client.MqttClient.serve`) under `smartmirror/camera/rpc/…`,
matching service.py's functions 1:1; state (mode, health, profiles) is
published retained so the app never polls.
"""

import logging

from shared.mqtt_client import MqttClient

from . import constants as topics, service

log = logging.getLogger(__name__)

_client = None


def client() -> MqttClient:
    global _client
    if _client is None:
        _client = MqttClient("camera_api").start()
    return _client


def serve_all() -> None:
    service.set_publisher(client().publish)

    def op_mode_set(req):
        return service.mode_set(req.get("mode"))

    def op_settings(req):
        return service.settings({k: v for k, v in req.items()
                                 if not k.startswith("_")})

    def op_dataset_list(req):
        return service.dataset_list(req.get("name") or "")

    def op_dataset_delete(req):
        return service.dataset_delete(req.get("name") or "", req.get("file") or "")

    def op_capture(req):
        return service.capture(req.get("name") or "", req.get("file"))

    def op_encode(req):
        return service.encode(req.get("name") or None)

    def op_profiles_delete(req):
        return service.profiles_delete(req.get("name") or "")

    def op_radar_set(req):
        return service.radar_set(bool(req.get("active")))

    c = client()
    c.serve(topics.RPC_HEALTH, lambda _req: service.health())
    c.serve(topics.RPC_MODE_GET, lambda _req: service.mode_get())
    c.serve(topics.RPC_MODE_SET, op_mode_set)
    c.serve(topics.RPC_SETTINGS, op_settings)
    c.serve(topics.RPC_DATASET_LIST, op_dataset_list)
    c.serve(topics.RPC_DATASET_DELETE, op_dataset_delete)
    c.serve(topics.RPC_CAPTURE, op_capture)
    c.serve(topics.RPC_ENCODE, op_encode)
    c.serve(topics.RPC_PROFILES_LIST, lambda _req: service.profiles_list())
    c.serve(topics.RPC_PROFILES_DELETE, op_profiles_delete)

    from features.radar import mqtt as radar_topics
    c.serve(radar_topics.RPC_SERVICE_GET, lambda _req: service.radar_get())
    c.serve(radar_topics.RPC_SERVICE_SET, op_radar_set)

    # Radar start/stop as a plain command, no reply expected.
    def on_radar_service(_topic: str, payload: str) -> None:
        import json
        try:
            op_radar_set(json.loads(payload or "{}"))
        except Exception:  # noqa: BLE001
            log.exception("radar service command failed")

    c.subscribe(radar_topics.SERVICE_CONTROL, on_radar_service)
    log.info("Serving camera RPC endpoints under %s", topics.RPC)
