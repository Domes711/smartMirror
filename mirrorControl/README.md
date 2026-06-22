# Mirror Control (React + TypeScript)

Companion mobile app for the smart mirror — a full React + TypeScript + Redux
Toolkit rewrite of the `Mirror Control` prototype (`reference/`). It lets you
configure, from your phone, what the mirror shows: **profiles**, **scenes**
(reusable widget layouts), **widgets** (store + AI builder), and **time
windows** — plus a hidden **dev mode** (radar / camera / MQTT comms).

> The home screen **is** the mirror: a live preview of the current state.

## Transport: MQTT-first

Communication with the mirror goes over **MQTT** wherever possible. The browser
connects **directly to the broker over WebSocket** (`mqtt.js`), so the app is a
true MQTT client rather than talking through an HTTP shim.

- **MQTT (primary)** — presence, radar targets, camera recognition, layout
  reload, control/reset, wake, calibration. Topics live in
  `src/services/mqtt.ts` and match the ones used across the repo
  (`smartmirror/...`).
- **REST (fallback, only what MQTT can't carry)** — the camera MJPEG stream,
  single JPEGs, photo upload, and request/response supervisor calls
  (`/layout`, `/store/*`). See `src/services/rest.ts`. These proxy to the
  existing `mirror-console` Express/supervisor on `:8000`.

### Broker WebSocket listener (required)

Mosquitto must expose a WebSocket listener. `camera/setup.sh` now installs
`/etc/mosquitto/conf.d/smartmirror.conf`:

```
listener 1883
protocol mqtt

listener 9001
protocol websockets

allow_anonymous true
```

TCP `1883` stays for the Pi-side daemons; `9001` is what this app connects to.

## Run

```bash
cd mirrorControl
npm install
cp .env.example .env     # point VITE_MIRROR_HTTP / VITE_MQTT_URL at the Pi
npm run dev              # http://localhost:5173
```

- `VITE_MIRROR_HTTP` — Pi HTTP base (Vite proxies REST through it in dev).
- `VITE_MQTT_URL` — broker WS URL, e.g. `ws://10.0.0.249:9001`. If unset the
  app derives `ws://<page-host>:9001`.

```bash
npm run build       # tsc --noEmit + vite build → dist/
npm run typecheck
```

## Architecture

```
src/
  app/        store.ts (RTK), hooks.ts, thunks.ts (side-effects/orchestration)
  features/   ui · scenes · modules · profiles · dev · settings  (RTK slices)
  services/   mqtt.ts (WS client + topics) · rest.ts · mirrorBridge.ts
  i18n/       labels.ts (cs/en) · useT.ts
  data/       catalog.ts (STORE, REGIONS, categories)
  components/ PhoneFrame shell, Mirror (preview/edit/thumb), Calendar, ui primitives
  screens/    Home, Scenes, Editor, Modules, Workshop, Profiles, … + dev/
  overlays/   modals, zone sheet, search overlay
```

- **State** is split into Redux Toolkit slices; cross-cutting flows (nav with
  side-effects, the task/agent simulations, MQTT publishes) live in
  `app/thunks.ts`.
- **`mirrorBridge.ts`** subscribes to `smartmirror/#` and fans presence / radar
  targets / recognition into the store, and feeds the dev MQTT monitor.
- **Design tokens** (`styles/tokens.css`) mirror the prototype palette: paper
  surfaces, hairline rules, one functional red (active/selected), one butter
  yellow (held/highlight). Fonts: Space Grotesk + Space Mono.

## Real data vs. fallback

On startup `connectMirror()` (`src/app/connect.ts`) pulls **real data** from the
`mirror-console` backend and maps it into the existing slices, so screens need
no changes:

- **Store / widgets** ← `GET /store/catalog` + `/modules` → the runtime widget
  catalog (`setRuntimeCatalog`), with real screenshots, `installed` flags, and
  community/own tabs. Install/uninstall hit `/store/install` (+ status polling)
  and `/store/uninstall`.
- **Profiles / users** ← `GET /profiles`; opening one loads its windows and its
  face photos from `/dataset` (real images via `/photo`). Capture/delete/retrain
  call `/capture`, `/dataset` (DELETE), `/encode`; deletion calls `/profiles`.
- **Scenes / layout** ← `GET /layout` (`layout_store.json`): each profile's time
  **windows** become scenes (cron `from`/`to` → hours, `{id,position}` →
  regions). Saving a scene / Apply serializes back via `PUT /layout` +
  `POST /layout/apply`.
- **Live state** ← MQTT over WebSocket (presence, radar targets, recognition).
- **Radar** toggle also flips the `ld2450` unit via `POST /radar`.

If the backend is unreachable (e.g. plain `npm run dev` with no Pi), the app
**falls back to the seed mocks** and keeps working for demos (`mirror.live =
false`). `src/services/api.ts` is the typed client for every endpoint.

### Still local / simulated
- The **AI module builder** (Workshop) still runs its 4-step status locally —
  the real `/api/modules/*` (Claude Agent SDK + SSE) is not yet wired.
- The **new-profile wizard** enrolls locally (real per-shot capture under a new
  dataset name + final `/encode` is a follow-up).
- Creating a **new configured module instance** (the console's field wizard) is
  not ported; the editor rearranges existing instances. The Settings network
  **scan** is cosmetic.
