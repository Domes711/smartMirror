# MMM-Health — Design Spec

**Date:** 2026-04-28
**Status:** Draft

## Goal

Show today's iPhone / Apple Watch health snapshot on the mirror: **steps**,
**active calories**, **sleep from last night**. Each metric rendered as
`current / goal` with a thin progress bar. Goals are pulled from Home
Assistant so the user can tweak them on the phone without redeploying.

Hidden behind `classes: "Domes"` — only visible after MMM-Profile / face
recognition switches to the user's profile.

## Why this source

Apple Health has no public API. The two reasonable paths off-device are:

1. **HA iOS Companion app** — exposes a fixed set of HealthKit sensors as
   `sensor.<device>_*` entities. Free, official, push-on-change.
2. **HealthAutoExport** — paid app, broader metric coverage, posts JSON
   to a webhook.

We already use HA for Reminders (MMM-HA-Reminders). Companion app covers
all three metrics we need (steps, active energy, sleep analysis), so we
reuse the same `haUrl` + token pattern. Zero new deps.

## Architecture

```
iPhone Health ──Companion app──► HA sensors ──REST──► node_helper.js ──socket──► MMM-Health.js ──DOM──► mirror
                                                       (poll 5 min)               (render rows)
```

Standard MM module shape, mirroring `MMM-HA-Reminders`:

- **`node_helper.js`** — every `refreshSec` (default 300), one `GET
  /api/states` call to HA, picks out the configured sensor entities,
  emits `MMHL_DATA` socket notification with current values + goals.
- **`MMM-Health.js`** — renders three rows; each row has label, value,
  goal, and a progress bar.
- **`MMM-Health.css`** — three rows, monospace numerics, thin bar.

## HA sensor contract

The HA iOS Companion app, with the relevant HealthKit toggles enabled
under *App Configuration → Sensors*, exposes:

| Metric | Default entity ID | Unit | Notes |
|---|---|---|---|
| Steps | `sensor.<device>_steps` | `steps` | Cumulative for the current local day, resets at midnight |
| Active energy | `sensor.<device>_active_energy` | `kcal` | Cumulative for the current local day |
| Sleep | `sensor.<device>_sleep_analysis` | `h` | Hours of "asleep" from last sleep window; updates after wake |

`<device>` is whatever the user named the iPhone in HA (e.g.
`sensor.domesphone_steps`).

Goals live as `input_number` helpers in HA, also fetched via `/api/states`:

| Goal | Default entity | Unit |
|---|---|---|
| Steps goal | `input_number.steps_goal` | `steps` |
| Active kcal goal | `input_number.active_kcal_goal` | `kcal` |
| Sleep goal | `input_number.sleep_goal_hours` | `h` |

Each `state` is a string; we coerce to `Number()` and treat anything
non-finite as "missing".

## Setup (iPhone → HA → Pi)

End-to-end, since the user is starting from scratch:

1. **Install HA Companion app** from the App Store on the iPhone, sign
   in to the existing HA instance.
2. In the app: *Settings → Companion app → Sensors*, scroll to the
   HealthKit section. Enable:
   - `Steps`
   - `Active Energy`
   - `Sleep Analysis`
   When prompted by iOS, grant Health permissions for the same metrics.
3. In HA → *Developer Tools → States*, confirm the three
   `sensor.<device>_*` entities exist and have non-`unknown` values.
   (Sleep takes one full sleep cycle to populate.)
4. In HA, create the three goal helpers: *Settings → Devices & Services
   → Helpers → Create Helper → Number*. Names map to the entity IDs in
   the table above. Set initial values (e.g. 10000 / 500 / 8).
5. Reuse the existing HA long-lived token from MMM-HA-Reminders; no
   second token needed.

If `sensor.<device>_sleep_analysis` doesn't appear in the user's app
version, fallback path: an iOS Shortcut runs on `CarPlay disconnect` /
fixed time → "Find Health Samples → Sleep Analysis (Asleep)" → POST
hours to an HA webhook → store in an `input_number.sleep_last_night`.
The module then points `sleepEntity` at that helper.

## Aggregation / display rules

- All three metrics are read **as-is** from HA. No rolling-window math
  here — the iOS app already resets steps/active-energy at midnight
  local time, and sleep is per-night.
- `progress = clamp(value / goal, 0, 1.2)` so over-100% bars overflow a
  little (visual "you crushed it") but cap at 120%.
- If any of (value, goal) is missing, that row shows `—` and an empty
  bar.
- Module silently skips a row if its entity isn't configured (`""`),
  so user can disable any of the three.

## UI

```
┌──────────────────────────────────────────┐
│ Kroky            8 421 / 10 000          │
│ ████████████████████░░░░░                │
│                                          │
│ Aktivní kcal       317 / 500             │
│ ███████████████░░░░░░░░░░                │
│                                          │
│ Spánek           7,2 h / 8 h             │
│ ██████████████████████░░░                │
└──────────────────────────────────────────┘
```

- Header configurable, default `"Zdraví"` (cs) / `"Health"` (en).
- Value/goal use `Intl.NumberFormat(locale)`; sleep uses 1 decimal.
- Bar is a div with width as a percentage; CSS-only, no canvas.
- Empty / unknown row: label · `—` · empty bar.
- Error state: error text + last successful timestamp ("naposledy
  aktualizováno HH:MM").

Rolls over implicitly: HA resets the daily counters at local midnight,
the next poll picks up the zero. No timer in the module.

## Configuration

```js
{
    module: "MMM-Health",
    position: "top_left",
    header: "Zdraví",
    classes: "Domes",
    config: {
        haUrl: "http://homeassistant.local:8123",
        haToken: "HA_TOKEN_PLACEHOLDER",      // real token only on Pi
        stepsEntity:        "sensor.domesphone_steps",
        activeEnergyEntity: "sensor.domesphone_active_energy",
        sleepEntity:        "sensor.domesphone_sleep_analysis",
        stepsGoalEntity:        "input_number.steps_goal",
        activeEnergyGoalEntity: "input_number.active_kcal_goal",
        sleepGoalEntity:        "input_number.sleep_goal_hours",
        refreshSec: 300,
        language: "cs"                        // "cs" | "en"
    }
}
```

Token is **scrubbed** in this repo (placeholder); the real token lives
only in `~/MagicMirror/config/config.js` on the Pi.

## Visibility / profile integration

Health is personal. The module entry carries `id: "health_domes"` and
the binding is added in `pages.js` under the `Domes` profile, same
pattern as `reminders_domes` / `spending_domes`.

## Failure modes

| Situation | Behavior |
|---|---|
| Token expired / 401 | Show error "HA token expired", keep retrying |
| HA unreachable | Show last good values + error banner |
| Missing entity (404 in `/api/states` payload) | That row shows `—`, others render |
| Sleep sensor never populated | Sleep row stays `—` until iOS pushes it |
| Goal helper missing | Row shows value-only, no bar |

## Out of scope

- Writing back to Apple Health / HA (read-only).
- Heart rate, weight, mindfulness, workouts.
- Multi-day trends / sparklines (possible follow-up).
- Caching to disk — RAM-only is fine.

## Dependencies

- Node 18+ (`fetch` built-in) — already used by MMM-HA-Reminders.
- No npm packages.
- HA iOS Companion app on the iPhone with HealthKit sensors enabled.

## References

- HA iOS Companion sensors:
  https://companion.home-assistant.io/docs/core/sensors/
- HA REST API `/api/states`:
  https://developers.home-assistant.io/docs/api/rest/
- Existing pattern: `MagicMirror/modules/MMM-HA-Reminders/`
