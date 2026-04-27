# MMM-Package-Tracker

Universal package tracking for MagicMirror². Tracking numbers are entered on
the iPhone via the Home Assistant app (a dedicated `todo.*` list); courier and
status come from AfterShip's universal API. Delivered packages auto-complete
in HA so they vanish from the iPhone list and the mirror at the same time.

## How it works

```
iPhone (HA app) → todo.balicky → MMM-Package-Tracker → AfterShip API
                       ▲                    │
                       └──── status=completed ┘
                            (when Delivered)
```

The node_helper polls the configured todo entity every `refreshSec`, registers
new tracking numbers with AfterShip (courier auto-detected), refreshes known
ones, and persists state in `cache.json` so MM restarts don't waste API calls.

## Setup

### 1. Home Assistant — create the list

1. Settings → Devices & Services → **Add integration** → "Local To-do".
2. Name the list `Balíky` → entity becomes `todo.balicky`.
3. Open the HA app on the iPhone, confirm the list appears.

### 2. AfterShip — create an API key

1. Sign up at https://www.aftership.com (free tier: 100 shipments/month).
2. Settings → API Keys → create one labelled `magicmirror-pi`.
3. Save the key in your password manager.

### 3. MagicMirror — add the module

```js
{
    module: "MMM-Package-Tracker",
    position: "top_right",
    config: {
        header: "Balíky",
        haUrl: "http://10.0.0.42:8123",
        haToken: "<long-lived HA token>",
        todoEntity: "todo.balicky",
        aftershipApiKey: "<aftership key>",
        refreshSec: 1800,
        maxItems: 6,
        autoCompleteOnDelivered: true,
        pruneAfterDays: 14,
        language: "cs"
    }
}
```

`pm2 restart MagicMirror` and within a minute the module renders the items
already on the list.

## Adding a package from the iPhone

Two ways:

1. **Direct in the HA app** — open the `Balíky` list, tap +, paste the tracking
   number into the title, optionally write a label ("Amazon kabel") into the
   notes/description field.
2. **Shortcut from the share sheet** — create a Shortcut "Sledovat balík":
   - Input: text from the share sheet (the tracking number).
   - Action: *Call Service* → `todo.add_item`
     - Service data: `entity_id: todo.balicky`, `item: <Provided Input>`.
   - Optional: *Ask for input* → "Popis?" and pass the result as `description`.

## Config options

| Key | Default | Notes |
|---|---|---|
| `header` | `"Balíky"` | Module header text. |
| `haUrl` | `""` | HA base URL, e.g. `http://10.0.0.42:8123`. |
| `haToken` | placeholder | Long-Lived Access Token. |
| `todoEntity` | `"todo.balicky"` | The list created in Setup step 1. |
| `aftershipApiKey` | placeholder | Key from AfterShip dashboard. |
| `refreshSec` | `1800` | Poll cadence. 30 min keeps you well inside any sane API budget. |
| `maxItems` | `6` | Max rows rendered. |
| `autoCompleteOnDelivered` | `true` | Mark `Delivered` items completed in HA. |
| `pruneAfterDays` | `14` | Drop cache entries this old once they're gone from HA. |
| `language` | `"cs"` | `"cs"` or `"en"` for status labels and ETA formatting. |

## Cache

`cache.json` next to `node_helper.js`. Contents are non-secret (slugs and
statuses), but the file is `.gitignore`d to keep the repo clean. Safe to
delete — the next poll re-registers everything.

## Failure modes

| Failure | Behavior |
|---|---|
| HA unreachable | Status row "chyba HA"; previous data not re-rendered. |
| AfterShip unreachable | Per-tracking failure logged, row falls back to cached values. |
| Tracking number rejected by AfterShip (4022 already exists) | Recovered via keyword search. |
| HA token / AfterShip key missing | Status row "není nakonfigurováno". |

## Out of scope

- AfterShip webhooks (would need a public endpoint).
- Carriers AfterShip doesn't list (rare, check the courier table on aftership.com).
- Per-user filtering — single shared list.
