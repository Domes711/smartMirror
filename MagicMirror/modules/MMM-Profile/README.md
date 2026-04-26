# MMM-Profile

Presence-driven profile + page scheduler for the smart mirror.

This module is the single source of truth for "what's on the mirror right
now". It receives presence + face-recognition events from the Pi over HTTP,
runs a small state machine (asleep / scanning / user / dimming), shows a
Face ID-style indicator at `top_center`, and remaps every other module on
the mirror to the layout defined for the active `(user, time-of-day)` page.

See `docs/superpowers/specs/2026-04-26-mmm-profile-design.md` for the full
design and `docs/superpowers/plans/2026-04-26-mmm-profile.md` for the
task-by-task plan.

## How events flow

1. **LD2450 daemon** (Python, on the Pi) detects presence in the radar zone,
   pulses the display relay on, POSTs `{ event: "presence_on" }`, and spawns
   `face_reco_once.py`.
2. **face_reco_once.py** captures one frame from the camera, runs
   `face_recognition` against the trained pickle, and POSTs
   `{ event: "user_recognized", user: "<name>" }` or
   `{ event: "user_unknown" }`.
3. **MMM-Profile node_helper** receives the POST on
   `http://127.0.0.1:8080/mmm-profile/event`, forwards to the frontend.
4. **Frontend** updates the state machine, picks the active page from
   `pages.js`, and rearranges other modules accordingly.

After 60 s of `presence_off` without a new `presence_on`, the daemon pulses
the display relay back off and posts `presence_off`. The frontend keeps the
last user shown for that whole window so rapid presence flicker doesn't
re-trigger face recognition.

## Install (on the Pi)

```bash
cd ~/MagicMirror/modules/MMM-Profile
npm install        # pulls cron-parser
```

## Configure

```js
// config.js
const pages = require("./pages.js");

let config = {
    modules: [
        // every module that should ever appear on the mirror,
        // identified by a custom `id` field (see below)
        { id: "clock", module: "clock" },
        { id: "weather_current", module: "weather", config: { ... } },
        // ...
        {
            module: "MMM-Profile",
            position: "top_center",
            config: {
                defaultUser: "default",
                pages: pages
            }
        }
    ]
};
```

`pages.js` defines `globalLayout` (always-on modules) plus per-user windows
with cron `from`/`to` and per-window `layout` (`{ id, position }` pairs).
See `MagicMirror/config/pages.js` for the live config or the design spec
for the schema.

## Module identification

Each entry in `config.js` should carry a custom **`id`** field that the
page layouts in `pages.js` reference. If a module has only one instance
and no explicit `id`, the layout entry can match by module name. For
multiple instances of the same module (e.g. two `MMM-GoogleCalendar`s for
two users), each instance must have a unique `id`.

`position` in `config.js` is **ignored** for any module that appears in a
page layout — the active layout's `position` wins. Convention: omit
`position` in `config.js` for modules managed by MMM-Profile.

## Notes

- `cron-parser` is the only npm dependency.
- The HTTP route mounts on MagicMirror's existing Express server (default
  port 8080). No extra port to open in firewalls.
- Failures on the Pi side (face-reco crash, camera busy) are POSTed as
  `user_unknown` so the mirror still shows the default user's pages and
  doesn't get stuck in `scanning`.
