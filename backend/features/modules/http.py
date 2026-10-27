"""HTTP entrypoint for the modules feature.

Catalog reads stay HTTP (the app fetches the whole catalog as a page load,
not a pub/sub exchange). Install, uninstall and progress are MQTT-only — see
mqtt.py.
"""

from shared.http import Router

from . import service


def mount(router: Router) -> None:
    router.add("GET", "/store/catalog", lambda _r: service.catalog_full())
    router.add("GET", "/store/readme",
              lambda r: service.readme(r.query.get("id") or "",
                                       r.query.get("url") or ""))
