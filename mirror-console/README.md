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
    loading overlay. The profile detail also has a **Rozložení** tab — see
    *Layout editor* below.
  - **Radar** — live LD2450 view: an SVG map (radar at top center, range rings,
    the detection **target zone** ±X/Y where `presence: present` is sent) with
    live target dots, a presence indicator, and an **Aktivní/Vypnuto** switch
    that starts/stops the `ld2450` service (off ⇒ no MQTT at all). Live targets
    come from a new `smartmirror/radar/targets` topic published by the daemon
    and read via the MQTT SSE feed.
  - **MQTT** — buttons that publish every message the mirror uses (presence
    `present`/`absent`, recognition `{user}`, gesture finger counts, reset),
    plus a live monitor of the bus.
  - **Moduly (AI)** — build a brand-new MagicMirror module by chatting with
    Claude. Krok 1: name + description → scaffolds a standard 6-file module
    draft under `module-drafts/<name>/` (gitignored). Krok 2: a chat where
    **Claude runs on the Pi** (via the Claude Agent SDK — the Claude Code engine
    as a library) and edits the draft files in place; a side button reveals a
    live `<iframe>` preview of the module's `demo.html` that reloads after each
    change. **Nainstalovat na zrcadlo** copies the draft into
    `MagicMirror/modules/`, runs `npm install` if it has deps, and
    `pm2 restart MagicMirror`. The agent is constrained to file tools inside the
    draft dir (no Bash). See *AI module builder* below for setup requirements.

Enrollment endpoints (on the supervisor, proxied by Node): `POST /capture`
(`{name}`), `GET /dataset?name=`, `DELETE /dataset?name=&file=`,
`GET /photo?name=&file=`, `POST /encode`. Photos are saved with the same
RGB→BGR convention as `camera/capture_photos.py` so they stay consistent with
the existing dataset and encoder.
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
