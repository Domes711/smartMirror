# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smart mirror built on [MagicMirror²](https://magicmirror.builders/) running on
a Raspberry Pi. This repository holds the **design specs / plans** and a
**backup of the user-owned code and data** running on the Pi. The Pi is the
source of truth; this repo exists so nothing is lost if the SD card dies.

**Refactoring log**: see `REFACTOR.md` for major architectural changes and consolidation history.

## Target hardware

- **Pi:** `admin@10.0.0.249` (SSH)
- **MagicMirror root:** `~/smartMirror/MagicMirror/` (single source = the clone;
  the standalone `~/MagicMirror` is retired — `cleanup-pi.sh` removes it)
- **Frontend UI:** `http://10.0.0.249:8090` (PWA, mobile-first) — `frontend/`
- **Backend gateway:** `http://10.0.0.249:8000` (REST API only, no UI) — routes
  to the feature that owns each path (camera :8001, modules :8003,
  ai-modules :8004, mic :8005; scenes is MQTT-only, no port)
- **Camera:** RPi Camera Module (ribbon-connected, **mounted upside down** — frames rotated 180° in `backend/features/camera/supervisor.py` capture loop) — face recognition + gesture detection
- **Radar:** HLK-LD2450 on UART `/dev/ttyAMA0` @ 256000 baud
- **Monitor:** Dell U2515H (DDC/CI control via `ddcutil`, no GPIO)

## Repository layout

The repo is **self-contained and runnable** via setup scripts (see
[Setup](#setup-fresh-pi)). Three top-level pieces: a Python **`backend/`**, the
React **`frontend/`**, and the vendored **`MagicMirror/`** fork.

- `docs/superpowers/specs/` — approved design specs
- `docs/superpowers/plans/` — task-by-task implementation plans
- `REFACTOR.md` — refactoring log (major architectural changes)
- `setup.sh` — **master installer**: `git clone` → `./setup.sh` runs
  `backend/setup.sh` (which chains every feature), then MagicMirror and the
  frontend.
- **`backend/`** — all server-side code, **pure Python**, split into
  self-contained **feature folders**. Each feature owns its code, its MQTT
  topics, its systemd unit and its own `setup.sh`. **Full detail (ports,
  tables, file-by-file role) lives in `backend/README.md` — that file, not
  this section, is the source of truth; what follows here is orientation.**
  - `backend/shared/` — the only shared pieces: `db.py` (SQLite connection,
    WAL, migrations), `mqtt_client.py` (paho wrapper with reconnect +
    re-subscribe, `.serve()` = the RPC pattern), `systemctl.py`
    (systemctl/pm2/node helpers, plus `run_privileged_script()` for the one
    case a feature needs root it doesn't already have via a systemctl
    allowance), `http.py` (stdlib routed HTTP server), `paths.py` (every
    path, resolved lazily from the environment), `sys_config.py` (reads one
    key out of `config.js` by regex — just `language()` today),
    `setup-lib.sh` (the shared `install_unit`/`enable_unit`/`install_sudoers`/
    `init_db`/`pip_install` shell helpers every feature's `setup.sh` sources).
  - **The established per-feature shape** (`display/`, `mic/`, `modules/`,
    `ai_modules/`, and now `camera/` follow it in full): `constants.py`
    (MQTT topics + fixed values, no logic) → one or more plain worker files
    → `service.py` (the one orchestrator, business logic only — no MQTT/HTTP
    imports) → `mqtt.py` (RPC dispatch via `MqttClient.serve()`, calls
    `service.py` 1:1) / `http.py` (thin HTTP routes, same 1:1 rule) →
    `daemon.py` (entrypoint: wiring + the blocking `serve()`/`client.start()`
    call, no business logic of its own).
  - `backend/features/camera/` — **refactored onto the shape above.**
    `supervisor.py` (the HW-arbitration layer: mode machine, capture loop,
    JPEG encode — this is business logic, not a transport file, same role as
    `display/driver.py`) + `profiles.py` + `enrollment.py` + `gestures.py` +
    `encode_faces.py` are the workers; `service.py` is a thin orchestrator
    holding the live `Supervisor`; `mqtt.py`/`http.py` are transport;
    `daemon.py` is the supervisor's entrypoint (unit `camera-supervisor`,
    `:8001`). Camera is the one feature with a **second entrypoint**,
    `recognition_daemon.py` (unit `camera-recognition`, **disabled** — the
    supervisor starts/stops it) — the camera is exclusive hardware, so one
    process owning it must arbitrate the other.
  - `backend/features/radar/` — LD2450 daemon (unit `radar`). **Not yet on
    the constants/service split** — `mqtt.py` still holds the topic
    constants directly (the role `constants.py` has elsewhere), and
    `daemon.py` carries both the parser/tracker logic and the entrypoint in
    one file. Publishes presence + live `targets` over MQTT; calibration
    lives in SQLite (`config.py`).
  - `backend/features/scenes/` — scene/layout store + `pages.js` /
    `modules.js` codegen (unit `scenes`). **MQTT-only: no HTTP, no port** —
    so its shape is deliberately `mqtt.py` (topics) + `rpc.py` (RPC dispatch
    *and* the hot-load/apply orchestration in one file, since there is no
    second transport to separate it from) + `store.py` + `codegen.py` +
    `service.py` (the entrypoint — keeps that name here, not `daemon.py`,
    because it predates the convention and nothing forced the rename).
  - `backend/features/display/` — DDC/CI monitor control (unit `display`).
    Reference implementation of the full shape: `constants.py` → `driver.py`
    (ddcutil subprocess calls) → `service.py` → `mqtt.py` → `daemon.py`.
  - `backend/features/modules/` — the module store: `catalog.py` (what's
    available), `install.py` (clone/uninstall) are the workers; `service.py`
    orchestrates; `mqtt.py`/`http.py` are transport (`:8003`, unit
    `modules`); `daemon.py` is the entrypoint, seeding `catalog.seed_builtins()`
    on every boot. The community catalog comes from the **MMM-store** repo
    (github.com/Domes711/MMM-store — `mm-store.json` per module: names,
    descriptions, tags, screenshots and the `wizard` config fields) via
    `store_import.py`, a hand-run/`setup.sh` script, never the daemon. The AI
    module builder is a separate feature, `backend/features/ai_modules/`
    (`:8004`, unit `ai-modules`) — MQTT-only, its one HTTP route
    (`/module-draft/*`) is a zip the pub/sub transport cannot carry.
  - `backend/features/mic/` — USB mic config + test recording (`:8005`,
    unit `mic`). The mic itself is a **Wyoming satellite**
    (`wyoming-satellite` + `wyoming-openwakeword`, two external projects
    cloned under `$HOME` by this feature's `setup.sh`, run as their own
    systemd units — this feature does not run their code, only arbitrates
    them) streaming to Home Assistant's Assist pipeline; this feature
    implements no wake-word or assistant logic itself. Changing
    `device`/`satellite_name`/`wake_word` over MQTT regenerates and restarts
    the live `wyoming-satellite.service` via a root-only helper script
    (`apply-satellite-unit.sh`, invoked through a sudoers grant scoped to
    that one script's exact path) — see `backend/README.md`'s mic section
    for the full mechanism.
  - `backend/gateway.py` — the edge on `:8000` (unit `mirror-gateway`). A
    route table, nothing else: the app is a single-origin PWA but the
    features are separate units, so something has to map path → feature.
    Routes only the binary/streaming surfaces pub/sub cannot carry, plus a
    shrinking set of JSON twins kept while the frontend migrates to MQTT.
    `/api/modules/*` (the AI builder's pre-MQTT HTTP surface) is deliberately
    **not** routed — it doesn't exist on the backend any more; that frontend
    gap is tracked separately, not papered over here.
  - `backend/var/` — **per-Pi runtime state, gitignored**: `smartmirror.db`,
    `dataset/`, `encoded_faces.pickle`, `module-assets/`, `mic-recordings/`,
    `module-drafts/`.
  - `backend/tests/`, `backend/features/tests/`, `backend/features/<name>/tests/`,
    `backend/shared/tests/`, `backend/data/tests/` — 292 tests, hardware-free
    (picamera2/serial/GPIO/RPi.GPIO are lazily imported), so the whole suite
    runs on a laptop with no Pi: `cd backend && python3 -m pytest`.
    `features/tests/test_transports.py` is the one that matters most when
    touching a feature's `mqtt.py`/`http.py` split — it pins every MQTT RPC
    topic to its HTTP twin (where one exists) so the two transports cannot
    drift apart.
- **`frontend/`** — the UI app (React + TypeScript + Redux + Vite) on
  `http://<pi>:8090`, installed as the `mirror-control` unit. Mobile-first PWA.
  Talks **MQTT directly** over WebSocket `:9001` for live state and REST
  (same-origin, proxied to the gateway on `:8000`) for streams, uploads and
  CRUD. Screens: **Home**, **Scenes**, **Modules**, **Profiles**, **Dev**.
  (Formerly `mirrorControl/` — moved as-is, internals untouched.)
- `MagicMirror/` — **vendored fork** of MagicMirror² core (our fork adds
  per-instance `id` support). `MagicMirror/setup.sh` installs core + every
  module's deps; `start-magicmirror.sh` + `pm2-setup.sh` run it under pm2.
- `MagicMirror/config/config.js` — mirror of the Pi's `config.js`.
  Hand-maintained, and its `modules: []` array is **ignored** — module
  instances live in the DB. See `config/modules.js` below.
- `MagicMirror/config/modules.js` — **the module instances**, generated from
  the `scene_instances` table by `backend/features/scenes/codegen.py` and
  `require()`d by `js/utils.js`. One entry per instance: `id` + `module` +
  `placement` + `config`, no `position`.
- `MagicMirror/config/pages.js` — **the live layout schedule**, read by the
  core profile system (`MagicMirror/js/profile.js`) and **generated** by
  `backend/features/scenes/codegen.py` from the SQLite scene tables.
- `MagicMirror/js/profile.js` + `MagicMirror/js/main.js` — the **core**
  profile system (presence-driven state machine + cron-window layout
  resolution over MQTT). `modules/MMM-Profile/` is retired/legacy.
- `MagicMirror/modules/MMM-Brno-Transit/` — our own module (Brno IDS JMK departures from GTFS)
- `MagicMirror/modules/MMM-HA-Reminders/` — our own module (iPhone Reminders via Home Assistant todo entities)
- `MagicMirror/modules/MMM-Mail/` — fork of [MMPieps/MMM-Mail](https://github.com/MMPieps/MMM-Mail) pinned at `c24f973` with added `mailboxes` (multi-folder + per-folder `slaHours` countdown) on top of upstream
- `MagicMirror/modules/MMM-Spending/` — our own module (today's spending pulled from Wallet by BudgetBakers REST API)
- `MagicMirror/modules/MMM-GoogleCalendar/` — vendored fork of `randomBrainstormer/MMM-GoogleCalendar` v1.2.0 for visual customisation

### Ports

| Port | Unit | What |
|---|---|---|
| 8000 | `mirror-gateway` | edge — the only port the frontend talks to |
| 8001 | `camera-supervisor` | MJPEG stream, enrollment, mode, radar unit control |
| 8003 | `modules` | `/store/*`, `/module-assets/*`, `/module-installed/*` |
| 8004 | `ai-modules` | `/module-draft/*` (working-copy zip); everything else is MQTT-only |
| 8005 | `mic` | mic config, `/mic/recording` (test recording WAV) |
| 8080 | pm2 `MagicMirror` | the mirror display itself |
| 8090 | `mirror-control` | the frontend app |
| 1883 / 9001 | mosquitto | MQTT: TCP for daemons, WebSocket for the app |

### Persistence: one SQLite DB

`backend/var/smartmirror.db` (WAL mode — several processes read it) holds all
persistent state: scenes and per-profile module instances, the module catalog,
radar calibration and profiles.

**Modules: three layers.** `module_catalog` is what is *available* (one row per
module; `id` is the identity everything FKs to, `module_name` is the folder on
disk). `scene_instances` is what is *configured* — one row per
`(module_id, profile)`, so a personalised module (mail) has a separate
instance, with its own credentials, for each person. `scene_window_entries` /
`scene_default_entries` are *where and when* it shows.

Installing clones the repo and configures nothing; adding a module to a scene
is what creates the instance, owned by the profile that added it. A second
profile adding the same module does not re-clone — it gets its own instance.
Uninstalling is profile-blind: it deletes the clone, so it removes every
profile's instance of that type.

Each feature owns the tables prefixed with its name. **`profiles` is the one
cross-cutting table** — both `camera` (trained faces) and `scenes` (per-profile
layouts) FK into it, so deleting a person removes their scenes too instead of
leaving orphans behind. `profiles.is_default = 1` marks the profile used when
nobody is recognized (exactly one row, enforced by a partial unique index);
deleting it is refused in code.

Binary blobs stay as files: `var/encoded_faces.pickle` (the face model) and
`var/module-assets/<module_name>/*.png` (store screenshots, referenced by path).

Debug on the Pi with the `sqlite3` CLI:

```bash
sqlite3 ~/smartMirror/backend/var/smartmirror.db .tables
sqlite3 ~/smartMirror/backend/var/smartmirror.db 'select * from scene_windows'
```

**All SQL lives in `backend/data/`** — one module per table (plus
`device_config.py`, which serves the six identically-shaped `<device>_config`
tables). Features call functions, never queries; rules (validation, "the
default profile cannot be deleted", config derivation) stay in the feature.
See `docs/db-schema-cs.md` for the schema and the reasoning.

**While the mirror is in development, `_m001_initial` is edited in place.**
The Pi is wiped and rebuilt when the schema changes (`nuke-pi.sh`, or just
`rm backend/var/smartmirror.db*` then `./setup.sh`), so there are no
data-preserving migrations and no backward-compat shims. The append-only rule
("add the next `@migration`, never edit a released one") starts applying once
the DB holds something that cannot be re-created by hand.

Hardware settings live in `<device>_config` tables as key-value rows:
`profile = 'default'` rows are the defaults, a row naming a profile overrides
that one key for that person. The camera is the only device with no overrides
— it is what determines the profile, so it cannot be configured per person.
The core (`js/profile.js`) gets its dim/sleep timeouts from
`smartmirror/display/config` (retained), published by the display feature,
because the core has no database driver.

### What is MQTT and what stays HTTP

**MQTT is the transport.** Every JSON operation the backend exposes is an MQTT
**RPC endpoint** — commands, config, state and queries alike. HTTP survives
only for payload shapes pub/sub cannot carry.

RPC uses a payload-carried response-topic pattern (works on mosquitto's
v3.1.1, no MQTT 5 needed), implemented once in
`backend/shared/mqtt_client.py` as `MqttClient.serve()`:

```
request  → <endpoint topic>      {"_rid": …, "_reply": …, <args>}
reply    → the "_reply" topic    {"_rid": …, "ok": true,  …result}
                                 {"_rid": …, "ok": false, "error": …,
                                  "status": 404|409|500}
```

`_rid` correlates several in-flight requests on one reply topic; `status`
carries what the HTTP status used to be, so callers that distinguish 404 from
409 keep working. Omit `_reply` for fire-and-forget. Each feature declares its
endpoints in its own `mqtt.py` (`RPC_*` constants):

| Feature | Endpoint prefix |
|---|---|
| camera | `smartmirror/camera/rpc/…` (+ `radar/rpc/service/{get,set}`) |
| scenes | `smartmirror/scenes/rpc/…` |
| modules store | `smartmirror/modules/rpc/…` |
| mic | `smartmirror/mic/rpc/…` |
| AI builder | `smartmirror/ai_modules/*` — flat topics, no `rpc` segment; MQTT-only, no JSON HTTP twins (see `docs/features/ai_modules.md`) |

State is **pushed retained**, never polled: `camera/mode`, `camera/state`,
`camera/profiles`, `radar/status`, `radar/config`, `display/state` and
`modules/install/progress/<type>`. The AI agent's live token stream is
`smartmirror/ai_modules/stream/<scope>/<name>` — same event objects the SSE
stream carried.

Hot-loading a new module into the running core is MQTT too
(`smartmirror/core/hot-load` → `…/result`, handled in
`MagicMirror/js/profile.js`), so **no backend→core HTTP hop remains**.

**What is still HTTP, and why** (`backend/gateway.py` on :8000):

- `/stream.mjpg` — multipart MJPEG, unbounded
- `/photo`, `/module-assets/*`, `/module-installed/*` — binary files / a
  live module's own static tree (`modules`, `:8003`)
- `/module-draft/*` — the AI builder's working-copy zip (`ai_modules`, `:8004`)

`/api/modules/*` (chat, chat/stream SSE, draft/session CRUD) is **not**
routed any more — it was the AI builder's pre-MQTT HTTP surface and does not
exist on the backend today. The frontend still calls those paths; that gap
is tracked separately (frontend rework), not papered over by the gateway.

Everything else on :8000 is a **temporary JSON twin** of an RPC endpoint — the
same handler behind both transports — kept only while the frontend migrates
screen by screen. `backend/features/tests/test_transports.py` pins the two together
so they cannot drift. Delete the twins (and shrink the gateway to the list
above) once the app is fully on MQTT.

Deploy is **git pull**: the user pushes to git, then on the Pi
`cd ~/smartMirror && ./deploy.sh` — pulls master, applies DB migrations,
installs deps, rebuilds `frontend/`, restarts every unit + pm2 MagicMirror and
health-checks :8000 / :8090 / :8080. `./deploy.sh --full` also re-runs every
`setup.sh` (deps + units + migrations); `./deploy-fe.sh` is the app-only fast
path (no backend / core restart).

## Architecture: how the mirror decides what to show

The mirror is **event-driven**, not always-on. Read `MagicMirror/js/profile.js`
(the core profile system) plus `docs/superpowers/specs/2026-04-26-mmm-profile-design.md`
before changing anything that touches presence, face recognition, layout, or
display power.

> **Note (current arch):** events flow over **MQTT**, not HTTP, and the profile
> system lives in the **MagicMirror core** (`js/profile.js`), not a module. The
> camera is arbitrated by the camera feature's supervisor (which starts/stops
> the `camera-recognition` unit). Topics: `smartmirror/radar/presence` (`present`/`absent`),
> `smartmirror/radar/targets` (live positions), `smartmirror/camera/recognition`
> (`{user}`), `smartmirror/camera/gesture`, `smartmirror/control/reset`,
> `smartmirror/control/wake` (app → core: leave sleep),
> `smartmirror/control/message` (app → core: `{message,timer}` → alert on the
> mirror), plus `smartmirror/radar/{control,config}` for calibration and
> `smartmirror/scenes/applied` (scenes → everyone: a new layout is live).
> Each feature's topics are declared in its own `mqtt.py`.

Data flow:

1. **`backend/features/radar/daemon.py`** (unit `radar`) reads radar frames
   from UART, filters targets to the rectangular zone (`abs(x) ≤ 400mm AND
   0 < y ≤ 1500mm`), pulses GPIO17 to wake the display, and publishes
   `present`/`absent` on `smartmirror/radar/presence` plus live positions on
   `smartmirror/radar/targets`. Calibration is read from SQLite.
2. **`backend/features/camera/recognition_daemon.py`** (unit `camera-recognition`) is
   subscribed to that presence topic. On `present` it scans for up to 3 s
   against `var/encoded_faces.pickle` and publishes `{"user": "<name>"}` or
   `{"user": null}` on `smartmirror/camera/recognition`. Any failure also
   publishes `null`, so the mirror never gets stuck in `scanning`.
3. **`MagicMirror/js/profile.js`** (`ProfileManager`, core) subscribes to the
   MQTT topics above, runs the state machine
   (`asleep` / `scanning` / `user` / `dimming`), resolves the active layout from
   `config/pages.js`, and emits `PROFILE_STATE` over socket.io.
4. **`MagicMirror/js/main.js`** receives `PROFILE_STATE`, renders the Face ID
   indicator at `top_center`, and `projectLayout` **moves every id-bearing
   module** into the region from the layout for `(currentUser, current cron
   window)`.

Module-management contract in `modules.js` and `pages.js`:

- **The DB is the source of truth.** Module instances come from
  `scene_instances`, written out to `config/modules.js`; `config.js`'s
  `modules: []` is ignored. Both generated files are plain JS the core
  `require()`s, which is why SQLite can own the data without the core needing
  a database driver.
- Every instance carries an **`id`**. `pages.js` references instances by that
  `id`, and region placement is driven **solely** by `pages.js`.
- There is **no `position` field** — placement is pages.js-only. At startup
  every `region` instance's DOM is built in a hidden staging area and the
  profile system (`projectLayout`) moves it into the region from the active
  page.
- **`placement`** separates identity from positioning: `region` (default) is
  placed and hidden by the profile system; `overlay` (e.g. `alert`) renders
  through its own mechanism, so `projectLayout` must neither move nor hide it.
  An overlay instance still has an `id` like any other.
- `pages.js` schema: `defaults` (`{<userKey>: layout}` — per-user fallback shown
  when no window is active) plus `<userKey>.<windowName>` with 5-field cron
  `from`/`to` (`min hour dom month dow`, 0=Sunday). Active window = the one whose
  `from` fired most recently AND more recently than its `to`. Latest `from` wins
  on ties. Resolution = active window's layout, else `defaults[userKey]` (no
  separate always-on global layer). Edited in the app's scene editor (calendar
  windows + the **Výchozí** button per profile), stored in the `scene_*` tables
  and written out to `pages.js` by `backend/features/scenes/codegen.py`.
- The `default` user is the built-in fallback shown when no face is recognized
  (wake-up before face-reco finishes, `user_unknown`). It behaves like any other
  profile (time windows + a default layout), is always listed first in the
  app, and **cannot be deleted**.

The Face ID animation (scanning ring → checkmark / X-cross → avatar reveal)
has a **canonical reference** at `tests/face-id-animation.html` — the source of
truth. The core renders the indicator (`MagicMirror/js/main.js`), styled to
mirror that file. State → class on `.profile`: `scanning` (no class) /
`success` / `error`.

## Module file conventions

Each in-repo MagicMirror module follows the same shape:

- `<Name>.js` — frontend (registered via `Module.register`)
- `<Name>.css` — styles
- `node_helper.js` — backend (network calls, file I/O, subprocesses)
- `package.json` — `private: true`, only the deps the module actually needs
- `README.md` — what it shows, install + config, conventions
- `demo.html` — standalone browser preview that stubs `window.Module`,
  `window.Log`, etc., so the module can render with no MagicMirror running.
  Open via raw.githack URL (see Conventions).
- `demo-render.js` — Playwright script that screenshots `demo.html` for each
  scenario into `render-<scenario>.png`. Run on the Pi with the system-wide
  Playwright install:
  ```
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    node /opt/node22/bin/node demo-render.js
  ```

## Setup (fresh Pi)

**`setup.sh` self-bootstraps** — copy just this one file to the Pi and run it:

```bash
scp setup.sh admin@10.0.0.249:~
ssh admin@10.0.0.249 'bash ~/setup.sh'
```

When run from **outside** the repo (the component dirs aren't next to it),
`setup.sh` clones the repo into `~/smartMirror` (or `git pull` if present) and
hands off to the repo's `setup.sh`. Override repo/branch/dir:
`SMARTMIRROR_REPO=… SMARTMIRROR_BRANCH=… SMARTMIRROR_DIR=… bash setup.sh`
(default `git@github.com:Domes711/smartMirror.git`, branch `master`; use the
`https://…` repo URL if the Pi has no SSH key).

Run from **inside** the repo it just sets everything up:

```bash
cd ~/smartMirror && ./setup.sh   # backend (all features) + MagicMirror + frontend
```

The module catalog is **seeded into SQLite**, not cloned from a private repo —
`features.modules.daemon`'s `main()` calls `catalog.seed_builtins()` on every
boot (idempotent, no network), writing the in-repo built-ins. The community
catalog is imported from the MMM-store repo by
`cd backend && python3 -m features.modules.store_import` (clone/pull into
`var/mmm-store`, repo URLs + stars from modules.magicmirror.builders;
`features/modules/setup.sh` runs it, a failure only warns).

**Cleanup before a fresh start:**

- `cleanup-pi.sh` — full reset that **keeps the repo** for re-clone: removes our
  systemd units, the pm2 app + boot hook, autostart/cron entries, sudoers, our
  mosquitto listener config, the retired `~/MagicMirror`/`~/ld2450`, and the
  mic feature's external checkouts (`~/wyoming-satellite`,
  `~/wyoming-openwakeword`). **Backs up nothing** — real config and
  `backend/var/` (SQLite DB, enrolled faces, module assets) are gone once it
  runs; back them up yourself first if you need them.
- `nuke-pi.sh` — **total** reset: everything `cleanup-pi.sh` does **plus deleting
  `~/smartMirror` itself**. Also backs up nothing. Follow it with `setup.sh`
  (self-bootstraps outside the repo, see above) for a from-scratch rebuild.

`setup.sh` chains `backend/setup.sh` (which chains every feature's own
`setup.sh`), then MagicMirror and the frontend. They detect node/python and
the repo path, generate systemd units, apply DB migrations and build the web.
Remaining one-time steps it prints: enable UART (`raspi-config`) and
`pm2 startup` for boot autostart. (The scenes feature injects managed modules
`config/modules.js` and `config/pages.js` from the DB automatically.)

**All shell scripts print in English** — every `setup.sh`/`deploy.sh`/
`cleanup-pi.sh`/etc. echo/comment was in Czech until this was deliberately
changed; write new output in English too.

Services: `radar`, `display`, `scenes`, `modules`, `mic`,
`camera-supervisor`, `mirror-gateway`, `mirror-control` (all enabled);
`camera-recognition` (installed but **disabled** — the camera supervisor
starts/stops it); `wyoming-satellite` (installed but **disabled** —
`features.mic.service` starts/stops it to free the USB mic for a test
recording); `wyoming-openwakeword` (enabled — holds no mic handle, stays up);
MagicMirror under **pm2** (process name `MagicMirror`).

## Common commands

All commands run **on the Pi via SSH** (`ssh admin@10.0.0.249`) unless noted.

### MagicMirror

```bash
pm2 restart MagicMirror              # apply config / module / pages.js changes
pm2 logs MagicMirror --lines 100     # tail logs
cd ~/MagicMirror && ./setup.sh       # reinstall core + module deps
```

### Frontend (UI app)

```bash
cd ~/smartMirror/frontend && ./setup.sh         # build + (re)install service
# Or rebuild manually after git pull (requires nvm):
source ~/.nvm/nvm.sh && cd ~/smartMirror/frontend && npm run build
sudo systemctl restart mirror-control
journalctl -u mirror-control -f
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/
# Access from phone/laptop: http://10.0.0.249:8090
```

### Backend

```bash
cd ~/smartMirror/backend && ./setup.sh          # all features: deps + units + migrations
cd ~/smartMirror/backend/features/scenes && ./setup.sh   # just one feature

# Restart everything (features first, gateway last):
sudo systemctl restart radar display scenes modules camera-supervisor mirror-gateway
journalctl -u scenes -f
journalctl -u modules -f
journalctl -u camera-supervisor -f

# Through the gateway (the same origin the app uses):
curl -s http://127.0.0.1:8000/healthz | python3 -m json.tool     # camera
curl -s http://127.0.0.1:8000/store/catalog | head -c 300        # modules

# Scenes is MQTT-only — talk to it on the bus, not over HTTP:
mosquitto_pub -h 127.0.0.1 -t smartmirror/scenes/rpc/layout/get \
  -m '{"_reply":"cli/out"}' & mosquitto_sub -h 127.0.0.1 -t cli/out -C 1
```

### Database

```bash
sqlite3 ~/smartMirror/backend/var/smartmirror.db .tables
sqlite3 ~/smartMirror/backend/var/smartmirror.db 'select * from scene_windows'
sqlite3 ~/smartMirror/backend/var/smartmirror.db \
  'select module_name, source from module_catalog where source != "community"'
```

### Radar

```bash
sudo systemctl status radar
sudo systemctl restart radar
journalctl -u radar -f
sudo systemctl stop radar    # release /dev/ttyAMA0 before running viewer.py
```

### Display control

```bash
sudo systemctl status display
sudo systemctl restart display
journalctl -u display -f
# Test power toggle via MQTT:
mosquitto_pub -h 127.0.0.1 -t smartmirror/display/control/power -m 'on'
# Test brightness (0-100):
mosquitto_pub -h 127.0.0.1 -t smartmirror/display/control/brightness -m '50'
```

### Camera

```bash
sudo systemctl status camera-supervisor
journalctl -u camera-supervisor -f
# camera-recognition is started/stopped BY the supervisor — don't enable it.
curl -s http://127.0.0.1:8000/mode; echo
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"mode":"test_face"}' http://127.0.0.1:8000/mode
```

### Mic

```bash
sudo systemctl status mic wyoming-satellite wyoming-openwakeword
journalctl -u mic -f
# wyoming-satellite is started/stopped BY features.mic.service — don't enable it.
# Test recording (seconds, max 30) over MQTT, then fetch the WAV:
mosquitto_pub -h 127.0.0.1 -t smartmirror/mic/rpc/test_record \
  -m '{"seconds":5,"_reply":"cli/out"}' & mosquitto_sub -h 127.0.0.1 -t cli/out -C 1
curl -s -o test.wav http://127.0.0.1:8000/mic/recording
```

### Python tests

The whole backend suite is hardware-free (picamera2/serial/GPIO are lazily
imported), so it runs anywhere — including this repo without the Pi:

Tests live in a **`tests/` dir next to the code they cover** —
`data/tests/`, `features/<name>/tests/`, `shared/tests/`, and `tests/` for the
gateway. (`features/*/tools/test_*.py` are hardware probe scripts run by hand
on the Pi, not collected — see `norecursedirs` in `pytest.ini`.)

```bash
cd backend
python3 -m pytest                        # 292 tests
python3 -m pytest features/scenes/tests  # one feature
python3 -m pytest data/tests             # the schema constraints
python3 -m pytest -k cascade             # one behaviour
```

### Visual previews (no Pi needed)

- Module `demo.html`: open via raw.githack live URL (Conventions below).
- `tests/*.html`: open via htmlpreview.github.io URL (Conventions below).
- Radar viewer (Pi only, requires X / display):
  `cd backend && python3 features/radar/viewer.py` (add `--simulate` for a
  fake animated target). Stop the `radar` unit first — it holds the UART.

## External dependencies

Cloned from upstream on the Pi. Pin commit SHAs here as we install so the Pi
can be rebuilt from scratch.

| Component | Upstream | Install path | Pinned |
|---|---|---|---|
| MagicMirror² core | **vendored fork** https://github.com/Domes711/MagicMirror (branch `feature/mmm-profile-builtin`, adds per-instance `id`) — full core lives in this repo under `MagicMirror/` | `~/MagicMirror/` | v2.36.0 fork |
| MMM-Face-Reco-DNN | https://github.com/nischi/MMM-Face-Reco-DNN | `~/MagicMirror/modules/MMM-Face-Reco-DNN/` | TBD |
| MMM-GoogleCalendar | https://github.com/randomBrainstormer/MMM-GoogleCalendar | `~/MagicMirror/modules/MMM-GoogleCalendar/` (vendored fork in this repo) | v1.2.0 |
| IDS JMK GTFS feed | https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328 | downloaded by `MMM-Brno-Transit/node_helper.js` into its `cache/`, refreshed weekly | n/a |

## Core fork: changes vs upstream MagicMirror² (for upstreaming)

Our `MagicMirror/` is a **vendored fork of upstream v2.36.0** (branch
`feature/mmm-profile-builtin`). This section is the **delta** — everything we
changed in the core — so the work can later be ported back / re-integrated when
upstream moves on. Everything else under `MagicMirror/js/` and `css/` is
unmodified upstream. Our modules (`modules/MMM-*`) are not part of this delta.

**New files (entirely ours):**

- `js/profile.js` — **`ProfileManager`**: the whole core profile system. Connects
  to MQTT, runs the presence/recognition state machine
  (`asleep`/`scanning`/`user`/`dimming`), resolves the active layout from
  `config/pages.js` (per-user cron windows + `defaults[user]`), and emits
  `PROFILE_STATE` / `PROFILE_PREVIEW` / `MIRROR_MESSAGE` over socket.io. Also
  handles `smartmirror/control/wake` (manual wake from the app),
  `smartmirror/control/message` (a note to show on the mirror) and
  `smartmirror/core/hot-load` (load a module at runtime, answering on
  `…/hot-load/result`). No upstream equivalent.
- `css/profile.css` — Face ID indicator styles (scanning ring → check / X →
  avatar), mirroring `tests/face-id-animation.html`.

**Modified upstream files:**

- `js/app.js`
  - `require("./profile")`; after node_helpers start,
    `new ProfileManager(global.config, io, { hotLoadModule }).start()`.
  - **`hotLoadModule({moduleName, moduleId, moduleConfig})`** — `loadModule(name)`
    at runtime, `setExpressApp`/`setSocketIO`/`start()` the new node_helper, then
    `io.emit("MODULE_HOT_LOAD", …)` — load a brand-new module with **no restart**.
    Returns `{ok, status, …}` and is driven by **MQTT** (`profile.js` serves
    `smartmirror/core/hot-load`); the **`POST /module/hot-load`** Express route
    is a thin wrapper over the same function, kept for manual use.
- `js/utils.js`
  - **`loadModulesFile()`** — `require()`s `config/modules.js` (generated from
    SQLite by the scenes feature) and `loadConfig()` assigns it over
    `config.modules`, so the DB is the single source of truth for which module
    instances exist. Cache-busted, and degrades to `[]` with a log line when
    the file is missing or invalid rather than taking the core down. Upstream
    reads the `modules` array out of `config.js`.
- `js/loader.js`
  - module data carries **`id: moduleData.id`** (per-instance id — the headline
    fork feature; upstream has no `id`) and **`placement`** (`region` /
    `overlay`), which `main.js` needs in the browser.
  - **`hotLoadModule(moduleData)`** — fetch + register a module's JS at runtime
    (counterpart to the `/module/hot-load` route).
- `js/main.js`
  - **`projectLayout(layout)`** — moves every **`region`** instance's DOM into the
    region/`.container` named in the active layout and shows it; hides the rest
    (lockString `mm-profile`). `overlay` instances are skipped entirely. The
    sole placement mechanism.
  - socket handler **`MIRROR_MESSAGE`** — a note sent from the app
    (Zrcadlo → Poslat vzkaz) forwarded to the `alert` module as `SHOW_ALERT`.
  - socket handlers **`PROFILE_STATE`** (render Face ID indicator + projectLayout)
    and **`PROFILE_PREVIEW`** (projectLayout for the live preview; when it carries
    `scene` meta the indicator flips to **scene-setup mode** via
    `renderSceneEditing` — shows the edited scene's name + time window. The app
    publishes `smartmirror/profile/preview` `{layout, scene}` while a scene is
    open in the editor and `{exit:true}` on leave; `profile.js` restores the live
    state with `_push()`).
  - **Face ID indicator**: `buildProfileHTML` / `renderProfileIndicator` build a
    `#mm-profile` element into the `top_center` region (state → `.profile` class
    `scanning`/`success`/`error`).
  - **`createDomObjects` rewritten**: build DOM for every instance except
    `placement: "overlay"`, parked in a hidden **`#mm-hot-staging`** area;
    `position` is **ignored** (placement is pages.js-only). Upstream placed
    every module by its `position` here.
  - **`MM.addModule(mObj)`** — append a hot-loaded module at runtime (DOM in
    staging, `updateDom` + `start`), plus the **`MODULE_HOT_LOAD`** socket handler
    that drives it.
  - **`MM.updateDom` "displayed" guard relaxed**: upstream drops an update when a
    module has no `position`; our id-bearing modules have none (placement is
    pages.js-only), so the guard now also accepts a module with an **`id`** —
    otherwise every self-update (clock tick, weather refresh, …) is rejected and
    the module looks frozen after its first render.
- `package.json` — added deps: **`cron-parser` ^4.9.0** (cron-window resolution)
  and **`mqtt` ^5.11.2** (profile event bus). (`croner` is also present.)

**Contract this introduces:** module instances live in SQLite and are
generated into `config/modules.js` (`id`, `module`, `placement`, `config` — no
`position`); `config/pages.js` (also generated) decides placement per
`(user, cron window)`; the core projects/repositions live over
socket.io and hot-loads new modules without a pm2 restart. To upstream cleanly,
the profile system could become an opt-in core feature gated on `config.profile`
/ presence of `config/pages.js` (when absent, fall back to upstream
position-based `createDomObjects`).

## Specs and plans

Each feature has a **spec** (the design) and a **plan** (task-by-task
checkboxes). All plans are currently **unstarted** (no `- [x]` ticked).

Active plans (current architecture):

- **MMM-Profile** (supersedes the v1 face-reco + radar plans for everything
  except the Pi-side prerequisites). **Now implemented in the MagicMirror core**
  (`js/profile.js` + `js/main.js`), not as a module — the spec/plan remain the
  design reference.
  - Spec: `docs/superpowers/specs/2026-04-26-mmm-profile-design.md`
  - Plan: `docs/superpowers/plans/2026-04-26-mmm-profile.md`
- **MMM-Spending** (today's spending from Wallet by BudgetBakers)
  - Spec: `docs/superpowers/specs/2026-04-27-spending-design.md`
  - Plan: `docs/superpowers/plans/2026-04-27-spending.md`

Background plans (still partially relevant — see headers in each file):

- **LD2450 presence-detection** (`docs/superpowers/plans/2026-04-14-ld2450-presence-detection.md`)
  — extended by MMM-Profile; the Python daemon, parser, GPIO, systemd steps
  are still prerequisites.
- **Face recognition v1** (`docs/superpowers/plans/2026-04-14-magicmirror-face-recognition.md`)
  — superseded by MMM-Profile; tasks 1-3 (deps, MMM-Face-Reco-DNN install,
  encode photos) still feed `face_reco_once.py`.

### 3. Package tracking
- Spec: `docs/superpowers/specs/2026-04-27-mmm-package-tracker-design.md`
- Plan: `docs/superpowers/plans/2026-04-27-mmm-package-tracker.md`
- **What:** New `MMM-Package-Tracker` reads tracking numbers from a dedicated
  HA todo list (`todo.balicky`, populated from the iPhone HA app), enriches
  them with courier + status from AfterShip's universal API, and renders them
  on the mirror. `Delivered` items are auto-completed in HA so they vanish
  from the iPhone list and the mirror together.

## Conventions

- **New specs** → `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`
- **New plans** → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` with `- [ ]`
  checkbox steps, suitable for `superpowers:executing-plans` /
  `superpowers:subagent-driven-development`
- **Commits** use conventional-commit prefixes (`docs:`, `feat:`, `chore:`,
  `test:`); often scoped, e.g. `feat(MMM-Mail): ...`
- **Branches** for Claude-assisted work: `claude/<slug>`
- **Module visual previews live in `demo.html` next to the module's source**
  (`MagicMirror/modules/<MMM-Foo>/demo.html`). After pushing, post the live
  raw.githack.com URL — user wants a clickable preview link by default, not
  just PNGs:
  `https://raw.githack.com/Domes711/smartMirror/<branch>/MagicMirror/modules/<MMM-Foo>/demo.html`
  Append `?v=<sha>` if cache holds an old version.

## Executing the plans

Plans describe commands to run **on the Pi**. Workflow:

1. Walk through each step — either the user pastes output back, or Claude
   runs it over SSH when a live session is available.
2. After files exist on the Pi, copy the user-owned ones (see Repository
   layout) into the mirrored path here.
3. Tick `- [ ]` → `- [x]` in the plan, commit on the feature branch.
