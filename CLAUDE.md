# CLAUDE.md

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

Only files we own or have generated are mirrored. Third-party code stays in
its upstream repos; see [External dependencies](#external-dependencies) for
how to restore them.

- `docs/superpowers/specs/` — approved design specs
- `docs/superpowers/plans/` — task-by-task implementation plans
- `MagicMirror/config/config.js` — mirror of `~/MagicMirror/config/config.js`
- `MagicMirror/config/pages.js` — per-(user, time-window) layouts consumed by MMM-Profile
- `MagicMirror/modules/MMM-Profile/` — our own module (presence-driven profile + page scheduler; absorbed the former MMM-FaceRecoIndicator)
- `MagicMirror/modules/MMM-Brno-Transit/` — our own module (Brno IDS JMK departures from GTFS)
- `MagicMirror/modules/MMM-HA-Reminders/` — our own module (iPhone Reminders via Home Assistant todo entities)
- `MagicMirror/modules/MMM-Mail/` — fork of [MMPieps/MMM-Mail](https://github.com/MMPieps/MMM-Mail) pinned at `c24f973` with added `mailboxes` (multi-folder + per-folder `slaHours` countdown) on top of upstream
- `MagicMirror/modules/MMM-Spending/` — our own module (today's spending pulled from Wallet by BudgetBakers REST API)
- `MagicMirror/modules/MMM-GoogleCalendar/` — vendored fork of `randomBrainstormer/MMM-GoogleCalendar` v1.2.0 for visual customisation; replace upstream install on Pi
- `MagicMirror/modules/MMM-Face-Reco-DNN/dataset/Domes/` — training photos (used by `ld2450/face_reco_once.py`)
- `MagicMirror/modules/MMM-Face-Reco-DNN/encoded_faces.pickle` — encoded face data
- `ld2450/` — mirror of `~/ld2450/` (radar daemon, single-shot face_reco_once.py, tests, `ld2450.service`)

As each plan task is completed on the Pi, the matching files above are copied
back into this repo and committed. Nothing here is deployed automatically —
the Pi is edited directly.

## External dependencies

Cloned from upstream on the Pi. Pin commit SHAs here as we install so the Pi
can be rebuilt from scratch.

| Component | Upstream | Install path | Pinned |
|---|---|---|---|
| MagicMirror² core | https://github.com/MagicMirrorOrg/MagicMirror | `~/MagicMirror/` | TBD |
| MMM-Face-Reco-DNN | https://github.com/nischi/MMM-Face-Reco-DNN | `~/MagicMirror/modules/MMM-Face-Reco-DNN/` | TBD |
| MMM-GoogleCalendar | https://github.com/randomBrainstormer/MMM-GoogleCalendar | `~/MagicMirror/modules/MMM-GoogleCalendar/` (vendored fork in this repo) | v1.2.0 |
| IDS JMK GTFS feed | https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328 | downloaded by `MMM-Brno-Transit/node_helper.js` into its `cache/`, refreshed weekly | n/a |

**Update flow (run on Pi):**

```
cd ~/MagicMirror && git pull && npm install && pm2 restart MagicMirror
cd ~/MagicMirror/modules/<name> && git pull && npm install
```

## Planned features

Two independent features, each with an approved design spec and a task-by-task
implementation plan. Both plans are currently **unstarted**.

### 1. Face recognition profile switching
- Spec: `docs/superpowers/specs/2026-04-14-magicmirror-face-recognition-design.md`
- Plan: `docs/superpowers/plans/2026-04-14-magicmirror-face-recognition.md`
- **What:** `MMM-Face-Reco-DNN` watches the camera; on recognizing "Domes" it
  emits `CURRENT_USER`, a new `MMM-Greeting` module shows "Hi, Domes", and
  modules tagged `classes: "Domes"` (e.g. Google Calendar) become visible.
  After 2 min without a face → `EVERYBODY_LEAVES`, back to anonymous.

### 2. LD2450 presence-based display control
- Spec: `docs/superpowers/specs/2026-04-14-ld2450-presence-detection-design.md`
- Plan: `docs/superpowers/plans/2026-04-14-ld2450-presence-detection.md`
- **What:** Python systemd daemon reads LD2450 frames, filters targets to a
  rectangular zone (`abs(x) ≤ 400mm AND 0 < y ≤ 1500mm`), and pulses GPIO17
  on enter / after 2 min absence to toggle the display.

The two features are independent — face recognition handles *profile content*,
the radar handles *display power*.

## Conventions

- **New specs** → `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`
- **New plans** → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` with `- [ ]`
  checkbox steps, suitable for `superpowers:executing-plans` /
  `superpowers:subagent-driven-development`
- **Commits** use conventional-commit prefixes (`docs:`, `feat:`, `chore:`)
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
