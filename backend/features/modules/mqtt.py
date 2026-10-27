"""Broker connection and RPC dispatch for the modules feature (the module
store).

Every topic is an MQTT RPC endpoint (shared.mqtt_client.MqttClient.serve()):
request in, reply out, matching service.py's functions 1:1. Install progress
is published separately, outside the request/reply pattern, as it changes.
"""

import logging

from shared.mqtt_client import MqttClient

from . import constants, service

log = logging.getLogger(__name__)

_client = None


def client() -> MqttClient:
    global _client
    if _client is None:
        _client = MqttClient("modules_api").start()
    return _client


def serve_all() -> None:
    service.set_publisher(client().publish)

    def op_install(req):
        return service.install_start(req.get("id") or "")

    def op_uninstall(req):
        return service.uninstall(req.get("name") or "")

    c = client()
    c.serve(constants.RPC_CATALOG, lambda _req: service.catalog_full())
    c.serve(constants.RPC_README,
           lambda req: service.readme(req.get("id") or "", req.get("url") or ""))
    c.serve(constants.RPC_INSTALL, op_install)
    c.serve(constants.RPC_INSTALL_STATUS,
           lambda req: service.install_status(req.get("id") or ""))
    c.serve(constants.RPC_UNINSTALL, op_uninstall)
    log.info("Serving modules RPC endpoints under %s", constants.RPC)
