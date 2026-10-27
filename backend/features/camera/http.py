"""HTTP entrypoint for the camera feature.

Binary surfaces (`/stream.mjpg`, `/photo`) are HTTP-only and permanent — pub/
sub cannot carry an unbounded multipart stream or a binary blob. The JSON
routes are a migration shim over the same `service.py` functions MQTT calls;
delete them once the frontend is fully on MQTT (see CLAUDE.md).
"""

import os

from shared.http import HttpError, Router

from . import profiles, service


def mount(router: Router, sup) -> None:

    # ---- binary: HTTP only, by necessity ------------------------------- #
    @router.get("/stream.mjpg")
    def stream(req):
        h = req.handler
        h.send_response(200)
        h.send_header("Age", "0")
        h.send_header("Cache-Control", "no-cache, private")
        h.send_header("Pragma", "no-cache")
        h.send_header("Access-Control-Allow-Origin", "*")
        h.send_header("Content-Type",
                      "multipart/x-mixed-replace; boundary=FRAME")
        h.end_headers()
        try:
            while True:
                with sup.output.condition:
                    sup.output.condition.wait(timeout=5)
                    frame = sup.output.frame
                if frame is None:
                    continue
                h.wfile.write(b"--FRAME\r\n")
                h.wfile.write(b"Content-Type: image/jpeg\r\n")
                h.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n"
                              .encode("ascii"))
                h.wfile.write(frame)
                h.wfile.write(b"\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass
        return None

    @router.get("/photo")
    def photo(req):
        path = profiles.photo_path(req.query.get("name", ""),
                                   req.query.get("file", ""))
        if not os.path.isfile(path):
            raise HttpError(404, "not found")
        with open(path, "rb") as f:
            req.handler.blob(f.read(), "image/jpeg")
        return None

    # ---- JSON twins: delete once the app is fully on MQTT -------------- #
    router.add("GET", "/healthz", lambda r: service.health())
    router.add("GET", "/mode", lambda r: service.mode_get())
    router.add("POST", "/mode", lambda r: service.mode_set(r.body().get("mode")))
    router.add("POST", "/resolution",
              lambda r: service.resolution(r.body().get("width"),
                                           r.body().get("height")))
    router.add("GET", "/dataset",
              lambda r: service.dataset_list(r.query.get("name", "")))
    router.add("DELETE", "/dataset",
              lambda r: {"ok": True, **service.dataset_delete(
                  r.query.get("name", ""), r.query.get("file", ""))})
    router.add("POST", "/capture",
              lambda r: service.capture(r.body().get("name") or "",
                                        r.body().get("file")))
    router.add("POST", "/encode",
              lambda r: service.encode(r.body().get("name")))
    router.add("GET", "/profiles", lambda r: service.profiles_list())
    router.add("DELETE", "/profiles",
              lambda r: service.profiles_delete(r.query.get("name", "")))
    router.add("GET", "/radar", lambda r: service.radar_get())
    router.add("POST", "/radar",
              lambda r: service.radar_set(bool(r.body().get("active"))))
