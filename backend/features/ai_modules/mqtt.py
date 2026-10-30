"""Broker connection and request dispatch for the ai_modules feature.

Each topic is an MQTT RPC endpoint (shared.mqtt_client.MqttClient.serve()):
request in, reply out, matching service.py's functions 1:1. The agent's
live token stream is published separately, outside the request/reply
pattern, as it is generated.
"""

import logging

from features.ai_modules import constants, service

log = logging.getLogger(__name__)


class AiModulesMqtt:
    """Owns the broker connection: serves every RPC endpoint, publishes the
    agent's live stream."""

    def __init__(self, client):
        self.client = client
        service.set_stream_publisher(self._publish_stream)

    def _publish_stream(self, scope: str, name: str, event: dict) -> None:
        self.client.publish(constants.stream_topic(scope, name), event)

    def serve_all(self):
        self.client.serve(constants.STATUS, lambda req: service.status())
        self.client.serve(constants.LIST, lambda req: service.list_drafts())
        self.client.serve(constants.DRAFT_CREATE, self._draft_create)
        self.client.serve(constants.EDIT_OPEN, self._edit_open)
        self.client.serve(constants.MESSAGE, self._message)
        self.client.serve(constants.SESSION, self._session_get)
        self.client.serve(constants.INSTALL, self._install)
        self.client.serve(constants.CONFIG_START, self._config_start)
        self.client.serve(constants.CONFIG_MESSAGE, self._config_message)
        self.client.serve(constants.CONFIG_END, self._config_end)
        log.info("Serving ai_modules RPC endpoints under %s", constants.BASE)

    def _draft_create(self, req: dict) -> dict:
        return service.draft_create(req.get("name") or "",
                                    req.get("description") or "")

    def _edit_open(self, req: dict) -> dict:
        return service.edit_open(req.get("name") or "")

    def _message(self, req: dict) -> dict:
        return service.new_message(req.get("scope") or "", req.get("name") or "",
                                   req.get("message") or "")

    def _session_get(self, req: dict) -> dict:
        return service.session_get(req.get("scope") or "", req.get("name") or "")

    def _install(self, req: dict) -> dict:
        return service.install(req.get("scope") or "", req.get("name") or "",
                               bool(req.get("overwrite")))

    def _config_start(self, req: dict) -> dict:
        return service.config_start(req.get("chatId") or "",
                                    req.get("module") or {})

    def _config_message(self, req: dict) -> dict:
        return service.config_message(req.get("chatId") or "",
                                      req.get("message") or "")

    def _config_end(self, req: dict) -> dict:
        return service.config_end(req.get("chatId") or "")
