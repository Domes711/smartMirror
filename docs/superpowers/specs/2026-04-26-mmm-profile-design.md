# MMM-Profile — Presence-Driven User Profile and Page Scheduling

**Date:** 2026-04-26
**Status:** Approved
**Supersedes:**
- `docs/superpowers/specs/2026-04-14-magicmirror-face-recognition-design.md`
  (continuous face recognition replaced by on-demand single shot)
- Extends `docs/superpowers/specs/2026-04-14-ld2450-presence-detection-design.md`
  (radar daemon also drives face-reco trigger and posts presence events)

## Goal

Replace the two independent v1 features (continuous face recognition + standalone
radar/display control) with one event-driven pipeline that decides what is
shown on the mirror based on **(presence, user, time-of-day)**:

1. LD2450 radar detects presence in the configured zone
2. On enter: wake the display, show the *default* page for the current
   time-of-day, then run a **single-shot** face recognition
3. Recognition result switches to the user-specific page for the current time
4. On exit: 60 s timeout, then sleep the display
5. While someone is in the zone, no re-recognition runs (mirror remembers them
   even across short absences within 60 s)

The motivation is a smoother UX (no flicker), much lower CPU load (face-reco
runs once per session rather than every 2 s), and a single declarative source
of truth for "what does the mirror show right now".

## Architecture

```
   LD2450 daemon (Python / systemd)
   ├── reads UART, filters zone (already specced)
   ├── tracks PRESENT/ABSENT with 60 s absence timeout
   ├── pulses GPIO17 to toggle display power
   ├── on PRESENT: spawns face_reco_once.py
   ├── HTTP POST /mmm-profile/event:
   │      { event: "presence_on" | "presence_off" }
   ▼

   face_reco_once.py (Python, on Pi)
   ├── opens RPi camera, grabs one frame
   ├── runs face_recognition against encoded_faces.pickle
   ├── HTTP POST /mmm-profile/event:
   │      { event: "user_recognized", user: "Domes" }
   │   or { event: "user_unknown" }
   │
                      ▼
   ┌────────────────────────────────────────────┐
   │ MMM-Profile (single MagicMirror module)    │
   │  ├── node_helper.js — HTTP listener        │
   │  └── frontend                              │
   │       ├── state machine                    │
   │       ├── Face ID indicator UI             │
   │       └── DOM remap of every other module  │
   │           per the active page layout       │
   └────────────────────────────────────────────┘
                       │
                       ▼
        every other module (weather, transit,
        calendar, reminders, news, …) — its
        position and visibility is now driven
        by pages.js, not by config.js
```

## State machine

```
                ┌──────────────────────────────────────────┐
                │                                          │
                ▼                                          │
            [asleep]                                       │
            • display: OFF (GPIO low)                      │
            • all page_* modules hidden                    │
            • waits for presence_on                        │
                │                                          │
                │ presence_on                              │
                ▼                                          │
            [awake, scanning]                              │
            • display: ON                                  │
            • indicator: Face ID animation                 │
            • shows default user's current-window layout   │
            • Pi runs face_reco_once.py                    │
                │                                          │
                │ user_recognized(X) | user_unknown        │
                ▼                                          │
            [awake, user=X | default]                      │
            • indicator: avatar + name                     │
            • shows page_<X>_<currentWindow>               │
            • waits for presence_off                       │
                │                                          │
                │ presence_off                             │
                ▼                                          │
            [awake, dimming X, 60 s timer]                 │
            • visuals unchanged                            │
            • timer counting down                          │
                │                                          │
                ├── presence_on (within 60 s)              │
                │       cancel timer, stay [awake, user=X] │
                │       (no re-recognition)                │
                │                                          │
                └── timer expires → [asleep] ──────────────┘
```

Key properties:

- **No 30 s polling.** Every transition is event-driven from the Pi
- **Time-of-day evaluation** happens at:
  - Wake-up (default page selected based on current cron windows)
  - After face-reco result (`page_<user>_<window>`)
- **No mid-session re-paint.** If the same user stands in front of the mirror
  for an hour and crosses a window boundary (e.g. morning → work), the page
  does **not** change. This avoids surprising the user.
- **Re-recognition only after a real absence.** Within the 60 s dim window,
  presence coming back keeps the previous user. Only after the mirror has
  fully gone to sleep does the next presence trigger a fresh face-reco.
- **Indicator visuals stay constant during dimming.** The 60 s countdown is
  not visualized; presence dropping is treated as transient until proven
  otherwise.

## Components

### LD2450 daemon (`~/ld2450/ld2450_daemon.py`)

Extends the existing daemon (parser + tracker + GPIO already specced and
implemented in repo) with:

- **HTTP client** that POSTs to MM on every PRESENT/ABSENT transition
- **Subprocess trigger:** on PRESENT enter, calls
  `python3 ~/ld2450/face_reco_once.py` and forgets it (the script POSTs its
  own result)
- **Configurable endpoint** in code (default `http://127.0.0.1:8080/mmm-profile/event`)

### face_reco_once.py (`~/ld2450/face_reco_once.py`) — new

- Opens the RPi camera (PiCamera2), grabs one frame
- Runs `face_recognition.face_locations` then `face_encodings`
- Compares against `~/MagicMirror/modules/MMM-Face-Reco-DNN/encoded_faces.pickle`
  (we keep the existing trained-data pickle — it's portable)
- POSTs result to MM:
  - `{ "event": "user_recognized", "user": "Domes" }` if a known face matches
  - `{ "event": "user_unknown" }` if a face is detected but doesn't match
  - Nothing posted (or `user_unknown`) if no face is detected within ~3 s
- Exits

Single-shot, ~2-5 s wall time on Pi 4. Runs concurrently with the daemon
without blocking it.

### MMM-Profile (`MagicMirror/modules/MMM-Profile/`)

Single MagicMirror module that subsumes:
- The previous `MMM-FaceRecoIndicator` (UI: Face ID scanning animation,
  recognized avatar, unknown badge)
- The page-scheduling responsibility (page = "list of modules with positions"
  to show for a given user + time window)

Files:

| File | Role |
|---|---|
| `MMM-Profile.js` | Frontend: state machine, indicator UI, DOM remap on page change |
| `node_helper.js` | HTTP listener at `/mmm-profile/event`, forwards to frontend |
| `MMM-Profile.css` | Face ID animation styles (lifted from MMM-FaceRecoIndicator) |
| `package.json` | `cron-parser` dep |
| `README.md` | Setup and config docs |

The frontend listens for socket notifications from the helper, runs the
state machine, computes the active page, and on page change:

1. Computes the union of `globalLayout` and the active window's `layout`
2. For each module known to MM, either:
   - Moves its DOM wrapper to the region indicated by the layout entry, then
     calls `module.show(0)`, **or**
   - Calls `module.hide(0)` if the module isn't in the active layout
3. Renders its own indicator UI (Face ID dots / avatar / question mark)

## Communication protocol

`POST http://127.0.0.1:8080/mmm-profile/event` (HTTP, localhost only, no auth)
with `Content-Type: application/json`:

| `event` | Other fields | Sent by |
|---|---|---|
| `presence_on` | — | LD2450 daemon, on PRESENT enter |
| `presence_off` | — | LD2450 daemon, after 60 s ABSENT |
| `user_recognized` | `user: "<name>"` | face_reco_once.py |
| `user_unknown` | — | face_reco_once.py |

The helper responds with `204 No Content` on success, `400` on a malformed
body. No retry semantics on the Pi side; if a POST is missed, the next
state-changing event recovers.

## Page configuration

A new file `MagicMirror/config/pages.js`. Imported by `config.js` and passed
into `MMM-Profile`'s `pages` config option.

```js
// pages.js
module.exports = {
    globalLayout: [
        { id: "clock", position: "top_left" }
    ],
    Domes: {
        morning:  { from: "0 6 * * 1-5",  to: "0 12 * * 1-5",
                    layout: [
                        { id: "weather_current",   position: "top_right" },
                        { id: "MMM-HA-Reminders",  position: "top_left"  },
                        { id: "MMM-GoogleCalendar",position: "top_left"  },
                        { id: "MMM-Brno-Transit",  position: "top_right" }
                    ] },
        work:     { from: "0 12 * * 1-5", to: "0 18 * * 1-5", layout: [...] },
        evening:  { from: "0 18 * * 1-5", to: "0 23 * * 1-5", layout: [...] },
        weekend:  { from: "0 8 * * 6,0",  to: "0 22 * * 6,0", layout: [...] },
        night:    { from: "0 23 * * *",   to: "0 6 * * *",    layout: [] }
    },
    default: {
        day:    { from: "0 6 * * *",  to: "0 23 * * *",
                  layout: [
                      { id: "weather_current", position: "top_right" }
                  ] },
        night:  { from: "0 23 * * *", to: "0 6 * * *", layout: [] }
    }
};
```

Field semantics:

- `globalLayout` (top-level, optional) — modules always visible regardless
  of user/window. Computed into the union with the per-window `layout`
- `<userName>: { <windowName>: { from, to, layout } }` — windows by user
  - `from` / `to` are 5-field cron expressions (`min hour dom month dow`,
    `0=Sunday..6=Saturday`)
  - **Active window** = the one whose `prev(from) > prev(to)` for the most
    recent moment. If multiple are active, the one with the most recent
    `from` wins. If none, no window is active and only `globalLayout` shows
- `layout: [{ id, position }, …]` — list of module references and where to
  put them
- `default` user — used when face-reco hasn't run yet (e.g. before wake
  completes) or returns `user_unknown` or `EVERYBODY_LEAVES`

## Per-user module config

There is no built-in concept of "this calendar belongs to that user".
Per-user configurations are handled by **separate module instances**, each
with a unique `id` in `config.js`, referenced by id from the respective
user's page layouts.

```js
// config.js
{ id: "calendar_domes", module: "MMM-GoogleCalendar",
  config: { calendars: [{ calendarID: "domes_placeholder@..." }] } },
{ id: "calendar_anna",  module: "MMM-GoogleCalendar",
  config: { calendars: [{ calendarID: "anna_placeholder@..." }]  } }
```

The penalty is duplicate node_helpers polling independently. For per-user
data (Google Calendar, HA reminders) the cost is negligible. For shared
data (Brno transit, weather) only one instance is created and referenced
from every user's page layouts.

## Module identification

Each entry in `config.js`'s `modules` array gets an optional **`id`** field
added by us (not a MagicMirror standard). Layout entries in `pages.js` match
modules by `id`. If `id` is omitted, `MMM-Profile` falls back to matching by
module name; this works only when there is exactly one instance of that
module, and it's an error if multiple instances would collide.

`position` in `config.js` is **ignored** for modules that appear in any
page layout; the active layout's `position` wins. Convention: omit `position`
in `config.js` for managed modules to avoid confusion.

## Migration from v1

Done in the implementation plan, summary here:

- **Delete `MagicMirror/modules/MMM-FaceRecoIndicator/`** — UI absorbed by MMM-Profile
- **Remove `MMM-Face-Reco-DNN` entry from `config.js`** — replaced by
  `face_reco_once.py` on the Pi. The trained dataset / pickle file stays
  on disk (used by face_reco_once.py)
- **Add `MMM-Profile` entry to `config.js`** at `top_center` (where the
  indicator lives)
- **Add `id` to all modules** that appear in any page layout
- **Drop `position`** from those modules in `config.js`
- **Drop `classes: "Domes"`** — page layouts now decide visibility per user
- **Create `pages.js`** with windows for `Domes` + `default`
- **Mark v1 specs/plans as superseded** with a header link to this doc

## Dependencies

| | |
|---|---|
| `cron-parser` (npm) | parsing 5-field cron in MMM-Profile.js. ~30 KB, no peer deps |
| `face_recognition` (pip, already installed by v1 face-reco plan) | used by face_reco_once.py |
| `picamera2` (apt, already on RPi OS) | camera capture in face_reco_once.py |
| `requests` (pip) | HTTP POST from Pi scripts. Tiny, often pre-installed |
| `express` *(optional)* | could simplify node_helper HTTP. Native `http` is fine for our endpoint |

## Out of scope

- Multi-mirror sync (one mirror, one MMM-Profile instance)
- Cloud-hosted page config
- Live config reload (changes to `pages.js` require MM restart)
- Auto-rotation between pages within one user-window (no carousel)
- Face-reco confidence thresholds tuning UI (kept in face_reco_once.py code)
