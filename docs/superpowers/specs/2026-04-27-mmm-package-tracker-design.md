# MMM-Package-Tracker — Universal Package Tracking via AfterShip

**Date:** 2026-04-27
**Status:** Draft

## Goal

Show the status of inbound packages on the mirror, regardless of carrier, with
zero per-carrier integration work. Tracking numbers are entered on the iPhone
through the Home Assistant app (a dedicated `todo.*` list), enriched with
courier + status by AfterShip's universal API, and displayed by a new
MagicMirror module. Delivered packages auto-disappear from both the mirror and
the HA list.

## Architecture

```
   iPhone (Home Assistant app)
   ├── user adds item to todo.balicky
   │     summary     = tracking number (e.g. "1Z999AA10123456784")
   │     description = optional human label (e.g. "Amazon kabel")
   ▼
   Home Assistant (todo.balicky entity)
   ▲
   │ poll every 30 min          ▲ todo.update_item (mark completed
   │ todo.get_items             │ when AfterShip status = Delivered)
   │
   MMM-Package-Tracker / node_helper.js
   ├── reads todo.balicky from HA
   ├── for each tracking number:
   │     • POST /trackings  (first time, idempotent — courier auto-detect)
   │     • GET  /trackings/{slug}/{number}  (subsequent polls)
   ├── on-disk cache: trackingNumber → { slug, status, expectedDelivery, … }
   └── pushes enriched list to frontend
   ▼
   MMM-Package-Tracker / frontend
   └── renders rows: label · courier · status · ETA / last event
```

## Data flow

1. **Input.** iPhone HA app → `todo.balicky` entity. Convention:
   - `summary` = tracking number (mandatory)
   - `description` = human label (optional, e.g. "Amazon kabel")
2. **Poll.** Every `refreshSec` (default 1800 = 30 min) the node_helper:
   1. Calls `todo.get_items` on the configured entity (same mechanism as
      MMM-HA-Reminders).
   2. For each open item whose `summary` is a non-empty string treated as a
      tracking number:
      - If the tracking number is **not yet in cache**: `POST /trackings` with
        `{ tracking_number }`. AfterShip auto-detects the courier (`slug`).
        Store `{ slug, status, expectedDelivery, lastEvent, lastChecked }`
        in cache.
      - If it **is in cache**: `GET /trackings/{slug}/{number}` to refresh.
   3. If status is `Delivered`, call HA `todo.update_item` with
      `{ entity_id, item: <uid>, status: "completed" }` so the row disappears
      on next poll.
3. **Render.** Frontend receives the merged list (todo item + AfterShip
   status) and renders one row per package.

## AfterShip details

| | |
|---|---|
| Plan | Free tier — 100 shipments/month, sufficient for personal use |
| Auth | `aftership-api-key: <key>` header |
| Base URL | `https://api.aftership.com/tracking/2024-04` (latest stable) |
| Couriers | 1100+, auto-detected from the tracking number |
| Rate limit | 10 req/s per account — far above our 30-min poll |
| Webhooks | Out of scope (would need reverse tunnel; polling is enough) |

Endpoints used:

| Method + path | Used for |
|---|---|
| `POST /trackings` | Register a new tracking number |
| `GET /trackings/{slug}/{tracking_number}` | Refresh status |
| `DELETE /trackings/{slug}/{tracking_number}` | Optional, on item removal |

Status values from AfterShip we care about:
`Pending`, `InfoReceived`, `InTransit`, `OutForDelivery`,
`AvailableForPickup`, `AttemptFail`, `Delivered`, `Exception`, `Expired`.

## Cache

A single JSON file at `MagicMirror/modules/MMM-Package-Tracker/cache.json`:

```json
{
  "1Z999AA10123456784": {
    "slug": "ups",
    "courierName": "UPS",
    "status": "InTransit",
    "expectedDelivery": "2026-04-30",
    "lastEvent": "Departed facility — Linz, AT",
    "lastEventTime": "2026-04-27T08:14:00Z",
    "lastChecked": "2026-04-27T11:00:00Z"
  }
}
```

Purposes:
- Survive MagicMirror restarts without spamming `POST /trackings`
- Avoid re-registering an already-known number
- Render last-known data immediately on boot, before the first poll completes

The cache is rewritten atomically (write to `cache.json.tmp` + rename) on every
successful poll. Entries for tracking numbers no longer present in the HA list
are dropped after `pruneAfterDays` (default 14) to keep the file tidy.

## Module config

```js
{
    module: "MMM-Package-Tracker",
    position: "top_right",
    config: {
        header: "Balíky",
        haUrl: "http://10.0.0.42:8123",
        haToken: "HA_TOKEN_PLACEHOLDER",
        todoEntity: "todo.balicky",
        aftershipApiKey: "AFTERSHIP_KEY_PLACEHOLDER",
        refreshSec: 1800,
        maxItems: 6,
        autoCompleteOnDelivered: true,
        pruneAfterDays: 14,
        language: "cs"
    }
}
```

## Frontend rendering

One row per package, sorted: `OutForDelivery` first, then `InTransit` /
`InfoReceived`, then `Exception` / `AttemptFail`, then everything else. Each
row contains:

```
[icon]  Amazon kabel                          v doručování
        UPS · očekáváno zítra
```

Where:

- **Line 1:** label (description) if present, else tracking number; on the
  right, the localized status badge.
- **Line 2:** courier name + relative ETA (`dnes`, `zítra`, weekday, or
  `DD.MM.`); falls back to the last event short text if no ETA.

Status localization (cs):

| AfterShip status | cs label | css class |
|---|---|---|
| Pending / InfoReceived | čeká na převzetí | mmpt-pending |
| InTransit | na cestě | mmpt-transit |
| OutForDelivery | v doručování | mmpt-out |
| AvailableForPickup | připraveno k vyzvednutí | mmpt-pickup |
| AttemptFail | nezastiženo | mmpt-warn |
| Exception / Expired | problém | mmpt-warn |
| Delivered | doručeno | mmpt-done |

`Delivered` is only rendered briefly; on the next poll the HA item is
auto-completed and the row disappears.

Empty state: `— žádné balíky`.
Error state: short message in `mmpt-status` row (e.g. `chyba HA`,
`chyba AfterShip`).

## Files

```
MagicMirror/modules/MMM-Package-Tracker/
├── MMM-Package-Tracker.js     # frontend
├── MMM-Package-Tracker.css    # styles, mirroring mmhar-* patterns
├── node_helper.js              # HA + AfterShip + cache
├── package.json                # no runtime deps; only dev/lint optional
├── cache.json                  # generated at runtime, gitignored
└── README.md                   # setup, HA/Shortcut instructions, screenshot
```

No npm runtime dependencies — Node 18+ has global `fetch`, and the cache is
plain JSON.

## Failure modes

| Failure | Behavior |
|---|---|
| HA unreachable | `mmpt-status` row "chyba HA"; cache still rendered |
| AfterShip unreachable | Cache rendered with stale `lastChecked` warning if > 6 h |
| Tracking number unknown to AfterShip | Row shown with status `čeká na převzetí`; AfterShip retries automatically |
| `POST /trackings` returns 4022 (already exists) | Treated as success; subsequent `GET` fetches the data |
| AfterShip quota exhausted | Logged; rows fall back to "—"; next month's reset recovers |
| HA token / AfterShip key missing | `mmpt-status` row "není nakonfigurováno" |

## Out of scope

- AfterShip webhooks (would require reverse tunnel from the public internet)
- Carriers AfterShip doesn't support (e.g. very small Czech regional couriers)
- Manual courier override per tracking number
- Notifications (push to phone) — HA can do this independently from a
  template sensor reading the same todo
- Multi-recipient packages (per-user filtering) — single shared list
