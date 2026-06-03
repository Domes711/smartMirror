# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Smart mirror built on [MagicMirror²](https://magicmirror.builders/) running on
a Raspberry Pi. This repository holds the **design specs / plans** and a
**backup of the user-owned code and data** running on the Pi. The Pi is the
source of truth; this repo exists so nothing is lost if the SD card dies.

## Target hardware

- **Pi:** `admin@10.0.0.249` (SSH)
- **MagicMirror root:** `~/MagicMirror/`
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
- `MagicMirror/config/config.js` — mirror of `~/MagicMirror/config/config.js`
  (hand-maintained; **never auto-edited** — the console splices in
  `console-modules.js` via a one-time manual `...require(...)`).
- `MagicMirror/config/pages.js` — **STALE/unused**; the live layout schedule is
  `MagicMirror/modules/MMM-Profile/pages.js` (loaded by its `node_helper.js`),
  and is **generated** by the console's layout editor.
- `MagicMirror/modules/MMM-Profile/` — our own module (presence-driven profile + page scheduler; absorbed the former MMM-FaceRecoIndicator)
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
  profile **Rozložení** layout editor → generates `pages.js` +
  `console-modules.js`), **Radar** (live map + on/off), **MQTT** (publish test
  messages + bus monitor). Backend `supervisor.py` is the single camera
  arbiter; `setup.sh` installs it as `mirror-console-backend`/`-web` systemd units.

Deploy is **git pull**: the user pushes to git, then `git pull` on the Pi.
Per-Pi runtime state (`radar_config.json`, `layout_store.json`,
`console-modules.js`, `vendor/`, `fonts/`, `node_modules/`) is gitignored.

## Architecture: how the mirror decides what to show

The mirror is **event-driven**, not always-on. Read `MagicMirror/modules/MMM-Profile/README.md`
plus `docs/superpowers/specs/2026-04-26-mmm-profile-design.md` before changing
anything that touches presence, face recognition, layout, or display power.

> **Note (current arch):** events now flow over **MQTT**, not HTTP. The camera
> is also arbitrated by `mirror-console` (the supervisor starts/stops
> `face_reco`). Topics: `smartmirror/radar/presence` (`present`/`absent`),
> `smartmirror/radar/targets` (live positions), `smartmirror/camera/recognition`
> (`{user}`), `smartmirror/camera/gesture`, `smartmirror/control/reset`, plus
> `smartmirror/radar/{control,config}` for calibration. The numbered steps below
> describe the original HTTP design and are kept for context.

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
3. **`MMM-Profile/node_helper.js`** receives all events on
   `http://127.0.0.1:8080/mmm-profile/event` (mounted on MagicMirror's
   existing Express server, no extra port).
4. **`MMM-Profile.js`** runs the state machine
   (`asleep` / `scanning` / `user` / `dimming`), renders the Face ID
   indicator at `top_center`, and **rearranges every other module on the
   mirror** to match the layout for `(currentUser, current cron window)` from
   `pages.js`.

Module-management contract in `config.js` and `pages.js`:

- Every module that should be controllable by MMM-Profile carries a custom
  **`id`** field in `config.js`. `pages.js` references modules by that `id`.
- For a managed module, `position` in `config.js` is **ignored** — the
  active page's `position` wins. Convention: omit `position` in `config.js`
  for managed modules.
- Unmanaged modules (`alert`, `updatenotification`, MMM-Profile itself) keep
  their `position` from `config.js` and stay visible always.
- `pages.js` schema: `globalLayout` (always-on) plus `<userKey>.<windowName>`
  with 5-field cron `from`/`to` (`min hour dom month dow`, 0=Sunday). Active
  window = the one whose `from` fired most recently AND more recently than its
  `to`. Latest `from` wins on ties.
- The `default` user must exist — used during wake-up before face-reco
  finishes and for `user_unknown` results.

The Face ID animation (scanning ring → checkmark / X-cross → avatar reveal)
has a **canonical reference** at `tests/face-id-animation.html`. Treat that
file as the source of truth; `MMM-Profile.css` mirrors its CSS. State →
class on `.profile`: `scanning` (no class) / `success` / `error`.

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

```bash
git clone <repo> smartMirror && cd smartMirror
./setup.sh        # camera + radar + console + MagicMirror, idempotent
```

`setup.sh` chains each component's `setup.sh` (they detect node/python and the
repo path, generate systemd units, build the web). Remaining one-time steps it
prints: enable UART (`raspi-config`), splice `...require('./console-modules.js')`
into `~/MagicMirror/config/config.js`, and `pm2 startup` for boot autostart.
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

## Specs and plans

Each feature has a **spec** (the design) and a **plan** (task-by-task
checkboxes). All plans are currently **unstarted** (no `- [x]` ticked).

Active plans (current architecture):

- **MMM-Profile** (supersedes the v1 face-reco + radar plans for everything
  except the Pi-side prerequisites)
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
