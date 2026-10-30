"""HTTP entrypoint for the modules feature.

Catalog reads stay HTTP (the app fetches the whole catalog as a page load,
not a pub/sub exchange). Install, uninstall and progress are MQTT-only — see
mqtt.py.
"""

from shared.http import Router

from . import service


def _int(v, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _catalog(r):
    """No `limit` → the whole store (the MQTT twin's shape). With `limit` →
    lazy paging for the app: ?offset=&limit=&q=&tag= (limit capped at 100)."""
    if "limit" not in r.query:
        return service.catalog_full()
    return service.catalog_page(_int(r.query.get("offset"), 0),
                                min(100, _int(r.query.get("limit"), 30)),
                                r.query.get("q") or "",
                                r.query.get("tag") or "")


def mount(router: Router) -> None:
    router.add("GET", "/store/catalog", _catalog)
    router.add("GET", "/store/readme",
              lambda r: service.readme(r.query.get("id") or "",
                                       r.query.get("url") or ""))
