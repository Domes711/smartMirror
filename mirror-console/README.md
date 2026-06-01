# mirror-console

Web console for the smart mirror's camera. The RPi camera is **exclusive**
(one process at a time), so this app is the single **arbiter**: from a phone or
laptop on the LAN you pick which consumer owns the camera, and in the test
modes you get a live view with detection overlays.

```
Browser (Mac / mobile)  ──►  Node/Express :8000  ──►  Python supervisor :8001  ──►  RPi camera
   mode switch + stream        serves React,            arbitrates the camera,
                               proxies /mode,/healthz,   runs overlays, toggles
                               /stream.mjpg              the face_reco daemon
```

## Modes

| Mode | Camera owner | What you see |
|---|---|---|
| **Face detect** (default) | `face_reco` systemd daemon (production) | status panel; daemon does real recognition |
| **Test obličejů** | this app | live MJPEG + face boxes & names |
| **Test gest** | this app | live MJPEG + MediaPipe hand landmarks + finger count |

Switching mode is atomic: the supervisor releases the current owner (stops the
daemon or its own capture), then hands the camera to the new one. The chosen
mode is persisted to `backend/mode.state` and restored on boot (default
`face_detect`, so the mirror works normally after power-on).

## Components

- `backend/supervisor.py` — camera arbiter + HTTP API (`/mode`, `/healthz`,
  `/stream.mjpg`) on `127.0.0.1:8001`. Reuses `count_fingers()` from
  `../camera/gesture_reco_once.py` and the face encodings pickle used by
  `../camera/face_reco_daemon.py`.
- `server/` — Express app on `0.0.0.0:8000`: serves the React build, proxies
  the supervisor, and bridges MQTT (publish test messages + a live SSE feed of
  all `smartmirror/#` traffic). Endpoints: `POST /api/mqtt/publish`
  (`{topic, payload}`), `GET /api/mqtt/stream` (SSE), `GET /api/mqtt/status`.
  MQTT broker via `MQTT_URL` (default `mqtt://127.0.0.1:1883`).
- `web/` — React + Vite front-end (responsive, mobile-friendly), tabbed:
  - **Kamera** — mode switcher + live stream (the camera arbiter UI).
  - **Profily** — one profile per learned face (`dataset/<name>/`). A grid of
    cards (sample photo, name, count); **＋ Přidat profil** opens a step
    **wizard**, and clicking a card opens the **profile detail**.
    - *Wizard* — Krok 1: name + base photo count. Krok 2: `FaceCaptureSession`
      (auto-capture every 3 s, **＋ Přidat další** to capture beyond the base
      set, enlargeable thumbnails with replace/delete), then **Dokončit a
      natrénovat** runs `camera/encode_faces.py`.
    - *Detail* — card-style tabs (more to come); **Fotky** shows all thumbnails
      (enlarge + delete), **＋ Přidat další fotky** (modal asks how many →
      capture session → **Přidat a přetrénovat**), **Přetrénovat**, and
      **Odebrat profil** (deletes the folder + rebuilds the pickle; empty
      dataset → empty pickle).

    `FaceCaptureSession` is the shared capture component used by both the wizard
    and the detail. Long operations (training, removal) show a full-screen
    loading overlay.
  - **Radar** — live LD2450 view: an SVG map (radar at top center, range rings,
    the detection **target zone** ±X/Y where `presence: present` is sent) with
    live target dots, a presence indicator, and an **Aktivní/Vypnuto** switch
    that starts/stops the `ld2450` service (off ⇒ no MQTT at all). Live targets
    come from a new `smartmirror/radar/targets` topic published by the daemon
    and read via the MQTT SSE feed.
  - **MQTT** — buttons that publish every message the mirror uses (presence
    `present`/`absent`, recognition `{user}`, gesture finger counts, reset),
    plus a live monitor of the bus.

Enrollment endpoints (on the supervisor, proxied by Node): `POST /capture`
(`{name}`), `GET /dataset?name=`, `DELETE /dataset?name=&file=`,
`GET /photo?name=&file=`, `POST /encode`. Photos are saved with the same
RGB→BGR convention as `camera/capture_photos.py` so they stay consistent with
the existing dataset and encoder.
- `systemd/` — autostart units. `sudoers.d/` — lets `admin` toggle `face_reco`.

## Install & run (on the Pi)

```bash
# 1. copy the folder to the Pi (from the repo root on your Mac)
scp -r mirror-console admin@10.0.0.249:/home/admin/smartMirror/

# 2. build the front-end + install the server deps (on the Pi)
cd ~/smartMirror/mirror-console/web    && npm install && npm run build
cd ~/smartMirror/mirror-console/server && npm install

# 3. let the supervisor control the daemon, and make it the sole camera authority
sudo cp ~/smartMirror/mirror-console/sudoers.d/mirror-console /etc/sudoers.d/
sudo visudo -cf /etc/sudoers.d/mirror-console     # verify syntax
sudo systemctl disable face_reco                  # supervisor manages it now

# 4. try it manually
cd ~/smartMirror/mirror-console/backend && python3 supervisor.py &
cd ~/smartMirror/mirror-console/server  && node index.js
#   open http://10.0.0.249:8000 from your Mac or phone
```

## Autostart

```bash
sudo cp ~/smartMirror/mirror-console/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mirror-console-backend mirror-console-web
```

Check the node path in `mirror-console-web.service` matches the Pi
(`which node`; CLAUDE.md mentions `/opt/node22/bin/node`).

## Dev (on the Pi, with the camera free)

```bash
cd ~/smartMirror/mirror-console/backend && python3 supervisor.py
cd ~/smartMirror/mirror-console/web     && npm run dev   # Vite proxies to :8001
```

## Notes

- **Single authority:** keep `face_reco` autostart **disabled** — otherwise it
  and the supervisor fight over the camera.
- **Color:** Picamera2 `RGB888` arrays are treated as BGR by OpenCV, so JPEG
  colors come out right with no conversion. If colors look swapped, add a
  `cv2.cvtColor` in `_capture_loop`.
- **Performance:** gesture overlay is light; face recognition (hog) is heavier
  and is throttled to every 5th frame.
- **Security:** no auth / TLS — LAN use only. The sudoers grant is limited to
  three `systemctl` calls on `face_reco`.
