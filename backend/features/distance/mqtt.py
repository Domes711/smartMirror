"""Broker connection and RPC dispatch for the distance feature.

Config is an MQTT RPC endpoint (shared.mqtt_client.MqttClient.serve()),
same pattern as mic/radar. Live readings and status are not RPC — they are
plain pushed topics, published straight from the daemon's read loop
(see daemon.py), same as radar's TARGETS/PRESENCE.
"""

import logging

from shared.mqtt_client import MqttClient

from . import config as distance_config
from . import constants

log = logging.getLogger(__name__)

_client = None


def client() -> MqttClient:
    global _client
    if _client is None:
        _client = MqttClient("distance_daemon").start()
    return _client


def serve_config() -> None:
    def op_config_set(req):
        values = {k: v for k, v in req.items() if not k.startswith("_")}
        distance_config.save(values)
        return distance_config.load()

    c = client()
    c.serve(constants.RPC_CONFIG_GET, lambda _req: distance_config.load())
    c.serve(constants.RPC_CONFIG_SET, op_config_set)
    log.info("Serving distance RPC endpoints under %s", constants.RPC)
