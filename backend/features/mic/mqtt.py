"""Broker connection and RPC dispatch for the mic feature.

Every topic is an MQTT RPC endpoint (shared.mqtt_client.MqttClient.serve()):
request in, reply out, matching service.py's functions 1:1.
"""

import logging

from shared.mqtt_client import MqttClient

from . import constants, service

log = logging.getLogger(__name__)

_client = None


def client() -> MqttClient:
    global _client
    if _client is None:
        _client = MqttClient("mic_daemon").start()
    return _client


def serve_all() -> None:
    def op_config_set(req):
        return service.config_set({k: v for k, v in req.items()
                                   if not k.startswith("_")})

    def op_test_record(req):
        return service.test_recording(req.get("seconds"))

    def op_service_set(req):
        return service.service_set(bool(req.get("active")))

    c = client()
    c.serve(constants.RPC_CONFIG_GET, lambda _req: service.config_get())
    c.serve(constants.RPC_CONFIG_SET, op_config_set)
    c.serve(constants.RPC_TEST_RECORD, op_test_record)
    c.serve(constants.RPC_SERVICE_GET, lambda _req: service.service_status())
    c.serve(constants.RPC_SERVICE_SET, op_service_set)
    log.info("Serving mic RPC endpoints under %s", constants.RPC)
