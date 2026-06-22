# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smart mirror built on [MagicMirror²](https://magicmirror.builders/) running on
a Raspberry Pi. This repository holds the **design specs / plans** and a
**backup of the user-owned code and data** running on the Pi. The Pi is the
source of truth; this repo exists so nothing is lost if the SD card dies.

## Target hardware

- **Pi:** `admin@10.0.0.249` (SSH)
- **MagicMirror root:** `~/smartMirror/MagicMirror/` (single source = the clone;
  the standalone `~/MagicMirror` is retired — `cleanup-pi.sh` removes it)
- **Camera:** RPi Camera Module (ribbon-connected) — face recognition
- **Radar:** HLK-LD2450 on UART `/dev/ttyAMA0` @ 256000 baud
- **Relay:** GPIO17 → display power button (presence-based display on/off)

## Repository layout

The repo is now **self-contained and runnable** via setup scripts (see
[Setup](#setup-fresh-pi)). The MagicMirror **core is a vendored fork** (ours),
plus our own modules, the camera/radar daemons, and the `mirror-console` web app.

- `docs/superpowers/specs/` — approved design specs
- `docs/superpowers/plans/` — task-by-task implementation plans
- `setup.sh` — **master installer**: `git clone` → `./setup.sh` runs every
  component's own `setup.sh` (camera, radar, console, MagicMirror) + sudoers.
- `MagicMirror/` — **vendored fork** of MagicMirror² core (full, runnable; our
  fork adds per-instance `id` support). `MagicMirror/setup.sh` installs core +
  every module's deps; `start-magicmirror.sh` + `pm2-setup.sh` run it under pm2.
- `MagicMirror/config/config.js` — mirror of the Pi's `config.js`. Hand-maintained
  except for the `// MIRROR-CONSOLE:START … :END` block, into which the console
  **auto-injects** the managed module instances (`id` + `module` + `config`, no
  `position`). Each module carries an `id`; `position` is omitted (placement is
  pages.js only).
- `MagicMirror/config/pages.js` — **the live layout schedule**, read by the core
  profile system (`MagicMirror/js/profile.js`) and **generated** by the console's
  layout editor. (The old `modules/MMM-Profile/pages.js` is retired.)
- `MagicMirror/js/profile.js` + `MagicMirror/js/main.js` — the **core** profile
  system (presence-driven state machine + cron-window layout resolution over
  MQTT; `main.js` `projectLayout` does the placement and renders the Face ID
  indicator). Replaces the old MMM-Profile module — `modules/MMM-Profile/` is
  retired/legacy.
- `MagicMirror/modules/MMM-Brno-Transit/` — our own module (Brno IDS JMK departures from GTFS)
- `MagicMirror/modules/MMM-HA-Reminders/` — our own module (iPhone Reminders via Home Assistant todo entities)
- `MagicMirror/modules/MMM-Mail/` — fork of [MMPieps/MMM-Mail](https://github.com/MMPieps/MMM-Mail) pinned at `c24f973` with added `mailboxes` (multi-folder + per-folder `slaHours` countdown) on top of upstream
- `MagicMirror/modules/MMM-Spending/` — our own module (today's spending pulled from Wallet by BudgetBakers REST API)
- `MagicMirror/modules/MMM-GoogleCalendar/` — vendored fork of `randomBrainstormer/MMM-GoogleCalendar` v1.2.0 for visual customisation; replace upstream install on Pi
- `camera/` — face recognition daemon + training (`face_reco_daemon.py`,
  `encode_faces.py`, `dataset/`, `encoded_faces.pickle`) + `setup.sh`.
- `ld2450/` — radar daemon, tests, `ld2450.service`, `setup.sh`. Publishes
  presence + live `targets` over MQTT; reads `radar_config.json` (per-Pi,
  gitignored) for calibration (offset/mirror, zone, smoothing, ghost exclusions).
- `mirror-console/` — **web console** (React + Vite + Express + Python
  supervisor) on `http://<pi>:8000`. Tabs: **Kamera** (camera arbiter —
  Face detect / Test obličejů / Test gest), **Profily** (enroll faces + per-
  profile **Rozložení** layout editor — time windows + a **Výchozí** default
  layout per profile → generates `config/pages.js` and injects managed modules
  into `config.js`; the non-deletable `default` profile is the no-recognition
  fallback), **Radar** (live map + on/off), **MQTT** (publish test
  messages + bus monitor), **Moduly (AI)** (build a new MagicMirror module by
  chatting with Claude — runs on the Pi via the Claude Agent SDK, edits a
  scaffolded draft with a live `demo.html` iframe preview, then installs it onto
  the mirror and registers it in the layout catalog; see `module-ai.js` +
  `mirror-console/README.md`). Backend `supervisor.py` is the single camera
  arbiter; `setup.sh` installs it as `mirror-console-backend`/`-web` systemd units.

Deploy is **git pull**: the user pushes to git, then `git pull` on the Pi.
Per-Pi runtime state (`radar_config.json`, `layout_store.json`,
`console-modules.js`, `mirror-console/backend/custom_modules.json`,
`mirror-console/module-drafts/`, `vendor/`, `fonts/`, `node_modules/`) is gitignored.

## Architecture: how the mirror decides what to show

The mirror is **event-driven**, not always-on. Read `MagicMirror/js/profile.js`
(the core profile system) plus `docs/superpowers/specs/2026-04-26-mmm-profile-design.md`
before changing anything that touches presence, face recognition, layout, or
display power.

> **Note (current arch):** events flow over **MQTT**, not HTTP, and the profile
> system lives in the **MagicMirror core** (`js/profile.js`), not a module. The
> camera is arbitrated by `mirror-console` (the supervisor starts/stops
> `face_reco`). Topics: `smartmirror/radar/presence` (`present`/`absent`),
> `smartmirror/radar/targets` (live positions), `smartmirror/camera/recognition`
> (`{user}`), `smartmirror/camera/gesture`, `smartmirror/control/reset`, plus
> `smartmirror/radar/{control,config}` for calibration. Steps 1-2 below keep the
> original HTTP wording for context (now MQTT); steps 3-4 reflect the core.

Data flow:

1. **`ld2450/ld2450_daemon.py`** (Python systemd unit on the Pi) reads radar
   frames from UART, filters targets to the rectangular zone (`abs(x) ≤ 400mm
   AND 0 < y ≤ 1500mm`), pulses GPIO17 to wake the display, and POSTs
   `{event: "presence_on"|"presence_off"}` to MagicMirror. On `presence_on`
   it spawns `face_reco_once.py` as a subprocess.
2. **`ld2450/face_reco_once.py`** captures one frame, runs `face_recognition`
   against `encoded_faces.pickle`, and POSTs `{event: "user_recognized",
   user: "<name>"}` or `{event: "user_unknown"}`. Any failure also posts
   `user_unknown` so the mirror never gets stuck in `scanning`.
3. **`MagicMirror/js/profile.js`** (`ProfileManager`, core) subscribes to the
   MQTT topics above, runs the state machine
   (`asleep` / `scanning` / `user` / `dimming`), resolves the active layout from
   `config/pages.js`, and emits `PROFILE_STATE` over socket.io.
4. **`MagicMirror/js/main.js`** receives `PROFILE_STATE`, renders the Face ID
   indicator at `top_center`, and `projectLayout` **moves every id-bearing
   module** into the region from the layout for `(currentUser, current cron
   window)`.

Module-management contract in `config.js` and `pages.js`:

- Every module that should appear on the mirror carries a custom **`id`** field
  in `config.js`. `pages.js` references modules by that `id`, and placement is
  driven **solely** by `pages.js`.
- The `position` field in `config.js` is **ignored entirely** — there is no
  position-based placement. At startup every id-bearing module's DOM is built in
  a hidden staging area and the profile system (`projectLayout`) moves it into
  the region from the active page. Omit `position` in `config.js`.
- A module **without an `id`** is never region-placed. Notification/overlay
  modules like `alert` still work (they render via their own mechanism, not a
  region), so they need no `id`.
- `pages.js` schema: `defaults` (`{<userKey>: layout}` — per-user fallback shown
  when no window is active) plus `<userKey>.<windowName>` with 5-field cron
  `from`/`to` (`min hour dom month dow`, 0=Sunday). Active window = the one whose
  `from` fired most recently AND more recently than its `to`. Latest `from` wins
  on ties. Resolution = active window's layout, else `defaults[userKey]` (no
  separate always-on global layer). Edited in the console layout editor (calendar
  windows + the **Výchozí** button per profile).
- The `default` user is the built-in fallback shown when no face is recognized
  (wake-up before face-reco finishes, `user_unknown`). It behaves like any other
  profile (time windows + a default layout), is always listed first in the
  console, and **cannot be deleted**.

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
cd ~/smartMirror && ./setup.sh   # camera + radar + console + MagicMirror, idempotent
```

`setup.sh` also clones the **private mm-store** repo into `store/` (the gitignored
module-catalog metadata: `store/modules/<MMM-Name>/mm-store.json` + screenshots).
Default `git@github.com:Domes711/MMM-store.git`; override with
`MM_STORE_REPO=… ./setup.sh`. If `store/` already exists it's `git pull`ed (or
left alone if it isn't a git repo). Missing this clone is why the store shows
raw `MMM-Xxx` names with no cs labels/tags.

**Cleanup before a fresh start:**

- `cleanup-pi.sh` — full reset that **keeps the repo** for re-clone: removes our
  systemd units, the pm2 app + boot hook, autostart/cron entries, sudoers, and
  the retired `~/MagicMirror`/`~/ld2450`; backs up real config + enrolled faces +
  per-Pi state to `~/mirror-backup-<ts>/` first.
- `nuke-pi.sh` — **total** reset: everything `cleanup-pi.sh` does **plus deleting
  `~/smartMirror` itself** (the backup is outside the repo, so config/faces/
  calibration survive). Pair it with `bootstrap.sh` for a from-scratch rebuild.

`setup.sh` chains each component's `setup.sh` (they detect node/python and the
repo path, generate systemd units, build the web). Remaining one-time steps it
prints: enable UART (`raspi-config`) and `pm2 startup` for boot autostart. (The
console injects managed modules into `config.js` between `// MIRROR-CONSOLE`
markers automatically — no manual `require()` splice; `console-modules.js` is
legacy.)
Services: `ld2450` (enabled), `mirror-console-backend`/`-web` (enabled),
`face_reco` (installed but **disabled** — the console starts/stops it),
MagicMirror under **pm2** (process name `MagicMirror`).

## Common commands

All commands run **on the Pi via SSH** (`ssh admin@10.0.0.249`) unless noted.

### MagicMirror

```bash
pm2 restart MagicMirror              # apply config / module / pages.js changes
pm2 logs MagicMirror --lines 100     # tail logs
cd ~/MagicMirror && ./setup.sh       # reinstall core + module deps
```

### Mirror console

```bash
cd ~/smartMirror/mirror-console && ./setup.sh   # build web + (re)install services
sudo systemctl restart mirror-console-backend mirror-console-web
journalctl -u mirror-console-web -f
curl -s http://127.0.0.1:8000/healthz; echo
```

### LD2450 daemon

```bash
sudo systemctl status ld2450
sudo systemctl restart ld2450
journalctl -u ld2450 -f
sudo systemctl stop ld2450    # release /dev/ttyAMA0 before running viewer.py
```

### Python tests (ld2450)

The parser, `PresenceTracker`, and other pure-Python pieces are deliberately
hardware-free at module level (no `serial` / `RPi.GPIO` import) so they can
run anywhere — including in this repo without the Pi:

```bash
cd ld2450
pytest                               # run all tests
pytest test_ld2450.py::test_parse_valid_frame_single_target   # one test
```

### Visual previews (no Pi needed)

- Module `demo.html`: open via raw.githack live URL (Conventions below).
- `tests/*.html`: open via htmlpreview.github.io URL (Conventions below).
- Radar viewer (Pi only, requires X / display): `python3 ld2450/viewer.py`
  or `python3 ld2450/viewer.py --simulate` for a fake animated target.

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
  `PROFILE_STATE` / `PROFILE_PREVIEW` over socket.io. No upstream equivalent.
- `css/profile.css` — Face ID indicator styles (scanning ring → check / X →
  avatar), mirroring `tests/face-id-animation.html`.

**Modified upstream files:**

- `js/app.js`
  - `require("./profile")`; after node_helpers start, `new ProfileManager(global.config, io).start()`.
  - **`POST /module/hot-load`** Express route: `loadModule(name)` at runtime,
    `setExpressApp`/`setSocketIO`/`start()` the new node_helper, then
    `io.emit("MODULE_HOT_LOAD", …)` — load a brand-new module with **no restart**.
- `js/loader.js`
  - module data carries **`id: moduleData.id`** (per-instance id — the headline
    fork feature; upstream has no `id`).
  - **`hotLoadModule(moduleData)`** — fetch + register a module's JS at runtime
    (counterpart to the `/module/hot-load` route).
- `js/main.js`
  - **`projectLayout(layout)`** — moves every **id-bearing** module's DOM into the
    region/`.container` named in the active layout and shows it; hides the rest
    (lockString `mm-profile`). The sole placement mechanism.
  - socket handlers **`PROFILE_STATE`** (render Face ID indicator + projectLayout)
    and **`PROFILE_PREVIEW`** (projectLayout only, for the console live preview).
  - **Face ID indicator**: `buildProfileHTML` / `renderProfileIndicator` build a
    `#mm-profile` element into the `top_center` region (state → `.profile` class
    `scanning`/`success`/`error`).
  - **`createDomObjects` rewritten**: build DOM **only for id-bearing modules**,
    parked in a hidden **`#mm-hot-staging`** area; `config.js` `position` is
    **ignored** (placement is pages.js-only). Upstream placed every module by its
    `position` here.
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

**Contract this introduces:** modules are declared in `config.js` with an `id`
and **no `position`**; `config/pages.js` (generated by mirror-console) decides
placement per `(user, cron window)`; the core projects/repositions live over
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
