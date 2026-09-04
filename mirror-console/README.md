# mirror-console

Backend + API gateway for the smart mirror. The RPi camera is **exclusive**
(one process at a time), so the Python supervisor is the single **arbiter**.
The Express server provides an API gateway that mirrorControl UI (on :8090)
uses to control the camera, manage profiles, and access MQTT bridge + AI tools.

```
mirrorControl :8090     ──►  Express API :8000    ──►  Python supervisor :8001  ──►  RPi camera
  (Vite UI, React PWA)       (gateway, MQTT bridge,   (camera arbiter, overlays,
                              AI builder, proxy)       face reco, dataset mgmt)
```

**UI is in `../mirrorControl/`** (port 8090). This folder contains only backend/API code.

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

- `backend/supervisor.py` — **Python camera arbiter** + HTTP API (`/mode`, `/healthz`,
  `/stream.mjpg`, `/mirror.mjpg`, `/capture`, `/dataset`, `/profiles`, `/encode`)
  on `127.0.0.1:8001`.
  Rotates frames 180° (camera mounted upside down), uses TurboJPEG encoder (TJPF_RGB)
  for fast JPEG. Reuses `count_fingers()` from `../camera/gesture_reco_once.py` and
  face encodings from `../camera/encoded_faces.pickle`. Installed as
  `mirror-console-backend` systemd unit.

- `backend/mirror_capture.py` — **live screencast of the real mirror screen**
  (`/mirror.mjpg` MJPEG, `/mirror.jpg` single frame). Attaches to the running
  MagicMirror **Electron window** over the Chrome DevTools Protocol
  (`--remote-debugging-port`, default 9222, passed by
  `../MagicMirror/start-magicmirror.sh`; `MM_DEBUG_PORT=0` disables it) and
  relays `Page.startScreencast` frames. This is the **actual screen** — the app's
  Home preview used to iframe `:8080`, which is a *second, independent*
  MagicMirror client and never shows the mirror's real state. Pure stdlib
  (its own minimal WebSocket client), lazy and refcounted: no CDP session while
  nobody is watching, and a frame older than 15 s is reported as unavailable
  (503) rather than served as if it were live.

- `server/` — **Express API gateway** on `0.0.0.0:8000`: proxies supervisor,
  bridges MQTT (publish + SSE stream of `smartmirror/#` traffic), hosts AI module
  builder. **Does NOT serve UI** (UI is `../mirrorControl/` on :8090).
  Endpoints:
  - Supervisor proxy: `/mode`, `/healthz`, `/stream.mjpg`, `/mirror.mjpg`,
    `/mirror.jpg`, `/capture`, `/dataset`, `/profiles`, `/radar`, `/layout`,
    `/store`, `/modules`
  - MQTT: `POST /api/mqtt/publish`, `GET /api/mqtt/subscribe`, `GET /api/mqtt/stream` (SSE),
    `GET /api/mqtt/status`
  - AI: `/api/modules/*` (AI module builder using Claude Agent SDK)
  - Assets: `/store-assets/*` (module screenshots from `../../store/modules/`)
  - Health: `GET /` (API status + endpoint list)

  Installed as `mirror-console-web` systemd unit. MQTT broker via `MQTT_URL`
  (default `mqtt://127.0.0.1:1883`).

**UI features (in `../mirrorControl/`):** Camera mode switcher + live stream,
Profile management (face enrollment wizard, photo grid, training), Radar live
view + control, Layout editor (Scenes with time windows), Module store + AI
builder, MQTT monitor. See `../mirrorControl/README.md`.

- `systemd/` — autostart units. `sudoers.d/` — lets `admin` toggle `face_reco`.

## AI module builder (Moduly → AI)

Endpoints (Express, in `server/module-ai.js`): `POST /api/modules/draft`
(`{name, description}` → scaffold), `GET /api/modules/chat/stream?name=` (SSE of
agent output), `POST /api/modules/chat` (`{name, message}` → one agent turn),
`GET /module-draft/<name>/…` (static — the preview iframe), `POST
/api/modules/finalize` (`{name, overwrite?}` → install + restart).

Requirements on the Pi:

- `npm install` in `server/` pulls in `@anthropic-ai/claude-agent-sdk`.
- `ANTHROPIC_API_KEY` must be set in the backend's environment (add it to the
  `mirror-console-web` systemd unit / shell), plus outbound HTTPS to
  `api.anthropic.com` (mind the network policy).
- Model defaults to `claude-opus-4-8`; override with `MODULE_AI_MODEL`.

The conversation is persisted per draft so you can come back and keep editing:
each turn is written to `<draft>/.module-chat.json` (machine transcript the UI
replays) and to `<draft>/CLAUDE.md` (human-readable + auto-loaded by the agent
as project memory, so a reopened module has its full history even after a
backend restart dropped the in-memory session). Step 1 lists existing drafts to
reopen. CLAUDE.md ships with the module; `.module-chat.json` does not.

Finalize also **registers the module in the layout editor**: it appends an entry
to `backend/custom_modules.json` (per-Pi, gitignored), which the supervisor
merges into its catalog at request time — so the new module is immediately
placeable in **Profily → Rozložení** (with empty config, no required fields).

### Editing an installed module (Obchod modulů → Upravit)

The same chat + live-preview editor (`ModuleEditor.jsx`) also edits an
**already-installed** module in place. In the Module Store detail, an installed
module shows an **Upravit** button next to Odinstalovat; it opens the editor
with `scope=installed`, operating directly on `MagicMirror/modules/<name>`.

On first open the backend ensures a `demo.html` exists (a generic preview
harness) and runs a one-time **adopt** turn: Claude reads the module, repairs
`demo.html` to render realistic sample data, and writes a short description —
which is stored, along with the ongoing chat, in the module's `CLAUDE.md`
(purpose + history) and `.module-chat.json`. **Restartovat zrcadlo** applies the
in-place edits to the running mirror (`pm2 restart`).

Endpoints add a `scope` (`draft` | `installed`) to the chat/session/stream
calls, plus: `POST /api/modules/edit/open`, `POST /api/modules/edit/prepare`
(adopt turn), `POST /api/modules/edit/restart`, and `GET
/module-installed/<name>/…` (preview static). The agent is still file-only and
constrained to the module's own directory.

## Layout editor (Profily → Rozložení)

Per-profile module layout editor. For each profile (= MMM-Profile user key) you
create **time windows** (e.g. 09:00–12:00) and place modules on an interactive
**mirror grid** (a ＋ at each of the 11 MagicMirror positions → modal to pick a
module and fill its required fields). The console owns a source-of-truth
`backend/layout_store.json` and **generates** two files in the live
MagicMirror (`MAGICMIRROR_DIR`, default `/home/admin/MagicMirror`):

- `modules/MMM-Profile/pages.js` — the `(user, window)` layout schedule.
- `config/console-modules.js` — the module instances it created (one per
  placement, so e.g. a calendar for user1 ≠ user2).

It **never** edits the hand-maintained `config.js`. Endpoints (proxied by Node):
`GET /modules`, `GET /layout`, `PUT /layout` (validates + regenerates),
`POST /layout/apply` (`pm2 restart MagicMirror`). Changes apply only on the
**Aplikovat na zrcadlo** button.

### One-time config.js edit (required, manual)

For the generated module instances to load, splice `console-modules.js` into the
modules array of `~/MagicMirror/config/config.js` **once**:

```js
const consoleModules = (() => {
  try { return require("./console-modules.js"); } catch (e) { return []; }
})();

let config = {
  // …
  modules: [
    // …your hand-maintained modules…
    ...consoleModules,
  ],
};
```

After that the console manages everything else. `pm2 restart MagicMirror` runs as
`admin` via `bash -lc` (loads the nvm PATH); no sudo needed.

## Install & run (on the Pi)

```bash
# 1. copy the folder to the Pi (from the repo root on your Mac)
scp -r mirror-console admin@10.0.0.249:/home/admin/smartMirror/

# 2. install the server deps (on the Pi)
cd ~/smartMirror/mirror-console/server && npm install

# 3. let the supervisor control the daemon, and make it the sole camera authority
sudo cp ~/smartMirror/mirror-console/sudoers.d/mirror-console /etc/sudoers.d/
sudo visudo -cf /etc/sudoers.d/mirror-console     # verify syntax
sudo systemctl disable face_reco                  # supervisor manages it now

# 4. try it manually
cd ~/smartMirror/mirror-console/backend && python3 supervisor.py &
cd ~/smartMirror/mirror-console/server  && node index.js &
#   API gateway on http://10.0.0.249:8000
#   UI is ../mirrorControl/ on http://10.0.0.249:8090
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
cd ~/smartMirror/mirror-console/server  && node index.js
# UI dev server is in ../mirrorControl/ (npm run dev on port 5173)
```

## Notes

- **Single authority:** keep `face_reco` autostart **disabled** — otherwise it
  and the supervisor fight over the camera.
- **Camera rotation:** Camera is mounted upside down, frames are rotated 180°
  in `_capture_loop` before detection/encoding.
- **Color:** Picamera2 returns `RGB888`. TurboJPEG encoder uses `TJPF_RGB` pixel
  format. No BGR conversion needed.
- **Performance:** TurboJPEG encoding ~3-5× faster than cv2.imencode(). Gesture
  detection runs every 3rd frame, face recognition every 10th (hog is slow).
- **Security:** no auth / TLS — LAN use only. The sudoers grant is limited to
  three `systemctl` calls on `face_reco`.
