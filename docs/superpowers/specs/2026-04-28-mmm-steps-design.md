# MMM-Steps — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Goal

Show today's step count from the user's iPhone on the mirror, sourced
from a Home Assistant pedometer sensor that the iOS Companion app
already publishes.

## Why this source

The user already runs Home Assistant and the iOS Companion app on the
iPhone (same pipeline as `MMM-HA-Reminders`). The Companion app exposes
a built-in **Pedometer** sensor that reads from Apple Health and resets
at local midnight — this is exactly the value we want, no extra cloud,
no extra auth flow, no Apple Health API to chase.

Tradeoff: iOS only sends updates when the phone is awake and the
Companion app is allowed to run in the background, so the value can lag
by a few minutes. Acceptable for a glanceable mirror tile.

## Architecture

```
iPhone (HA Companion)──►Home Assistant──REST──►node_helper.js──socket──►MMM-Steps.js──DOM──►mirror
                          sensor.<phone>_steps    (poll 60 s)             (render)
```

Standard MM module shape, mirroring `MMM-HA-Reminders`:

- **`node_helper.js`** — every `refreshSec` (default 60) does
  `GET <haUrl>/api/states/<stepsEntity>` with
  `Authorization: Bearer <haToken>`, parses `state` → integer, reads
  `last_updated`, emits `MMST_DATA` socket notification. Errors → `MMST_ERROR`.
- **`MMM-Steps.js`** — receives data, renders one big number, optional
  goal progress bar, and a small "stale" hint if the data is older than
  `staleAfterMin`.
- **`MMM-Steps.css`** — large step count, smaller goal/stale lines, thin
  progress bar.

## HA REST contract

**Endpoint:** `GET <haUrl>/api/states/<entity_id>`
**Auth:** `Authorization: Bearer <long-lived token>` (same token kind
as MMM-HA-Reminders — one HA token can serve all our modules).

**Response shape (relevant fields):**

```json
{
  "entity_id": "sensor.iphone_steps",
  "state": "6342",
  "attributes": {
    "Sensor Name": "Steps",
    "icon": "mdi:walk",
    "unit_of_measurement": "steps",
    "device_class": "",
    "friendly_name": "iPhone Steps"
  },
  "last_changed": "2026-04-28T08:42:13.123456+00:00",
  "last_updated": "2026-04-28T08:42:13.123456+00:00"
}
```

`state` is a numeric string; can be `"unknown"` or `"unavailable"`
shortly after HA boot or while the phone is asleep — treat both as "no
data yet" and keep the previous value (if any) on screen.

## iPhone setup (one-time)

In the iOS Companion app: *App Configuration → Sensors → Pedometer →
enable*. The sensor pushes to HA roughly every 5–15 minutes while the
phone is unlocked, and again on Significant Location Change events.
Background App Refresh and Location Always permission must be granted
or the value freezes when the phone screen is off.

After enabling, find the entity in HA → *Developer Tools → States* —
typical IDs are `sensor.<device_name>_steps`, e.g.
`sensor.iphone_domes_steps`. That literal string goes in `stepsEntity`.

## UI

```
┌──────────────────────────────┐
│   6 342                      │  ← .mmst-count (large, white)
│   ████████░░░  63 % z 10 000 │  ← .mmst-goal (medium, muted)
│   aktualizováno 08:42        │  ← .mmst-time (tiny, mutest)
└──────────────────────────────┘
```

- Header: "Kroky dnes" (configurable).
- Count: `Intl.NumberFormat("cs-CZ").format(steps)` so the thousands
  separator is a non-breaking space (Czech convention).
- Goal block: rendered only if `goal > 0`. Bar fills from 0 to `goal`,
  caps visually at 100 %, but the percent label keeps going past 100 %
  (e.g. `124 %`) so over-achievement is visible.
- Time: `aktualizováno HH:MM` from `last_updated` in `Europe/Prague`.
  If the gap is larger than `staleAfterMin` (default 30) the line
  switches to `nečerstvé · HH:MM` and the count fades to muted color.
- Empty / first load: `— čekám na data` until the first non-`unknown`
  reading arrives.
- Error state: error text + last good count if we ever had one.

Rolls over at local midnight automatically because HA's sensor resets
at midnight. We additionally trigger a refetch at the local-day
boundary (`setInterval(60_000)` checks `localDayKey`) so the screen
swaps from "23 947 kroků" to "0 kroků" without waiting for the next
poll cycle.

## Configuration

```js
{
  module: "MMM-Steps",
  position: "top_left",
  header: "Kroky dnes",
  classes: "Domes",                  // hidden until face-recognized
  config: {
    haUrl: "http://homeassistant.local:8123",
    haToken: "HA_TOKEN_PLACEHOLDER",  // real token only on Pi
    stepsEntity: "sensor.iphone_domes_steps",
    goal: 10000,                      // 0 disables goal block
    staleAfterMin: 30,
    refreshSec: 60,
    timezone: "Europe/Prague",
    language: "cs"                    // "cs" | "en"
  }
}
```

The HA token is **scrubbed** in this repo (placeholder); the real token
lives only in `~/MagicMirror/config/config.js` on the Pi (same one
already used by `reminders_domes`).

## Visibility / profile integration

Step count is personal, so the module is hidden by default and shown
only for the recognized user. Same pattern as `reminders_domes` /
`spending_domes`: in `config.js` the entry carries `id: "steps_domes"`
and the visibility binding is added in `pages.js` under the `Domes`
profile.

## Failure modes

| Situation | Behavior |
|---|---|
| HA unreachable | Show error banner + last good count, keep retrying |
| HA returns 401 | Show "HA token expired", keep retrying |
| `state` is `unknown` / `unavailable` | Keep last good count, show "čekám na data" if never seen one |
| `last_updated` older than `staleAfterMin` | Mark count as stale (muted color + label) |
| Entity doesn't exist (404) | Show "entita nenalezena" + the configured `stepsEntity` so the user can fix the typo |

## Out of scope

- Multi-day history / weekly chart — possible follow-up.
- Distance / active energy / heart rate — different sensors, different
  module.
- Writing back to HA / iOS (read-only).
- Caching to disk — RAM-only is fine, refresh recovers after restart.
- Multiple users on one mirror (steps for each phone) — the page
  scheduler decides which `steps_<user>` instance is visible at a time.

## Dependencies

- Node 18+ (`fetch` built-in) — already used by MMM-HA-Reminders.
- No npm packages.
- HA iOS Companion app with Pedometer sensor enabled on the iPhone.

## References

- HA iOS Companion sensors:
  https://companion.home-assistant.io/docs/core/sensors/
- HA REST API states endpoint:
  https://developers.home-assistant.io/docs/api/rest/#get-apistatesentity_id
- Existing pattern: `MagicMirror/modules/MMM-HA-Reminders/` in this repo.
