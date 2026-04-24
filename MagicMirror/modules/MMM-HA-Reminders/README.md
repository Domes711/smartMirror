# MMM-HA-Reminders

Shows iPhone Reminders on the mirror by reading Home Assistant `todo.*`
entities via the HA REST API. Expects you to set up the iPhone → HA
sync yourself; this module only reads what's already in HA.

Hidden by default behind `classes: "Domes"` — only shown after
MMM-Face-Reco-DNN recognizes you.

## Setting up iPhone → HA

Recommended path: **CalDAV integration in HA pointing at iCloud**.

1. On [appleid.apple.com](https://appleid.apple.com) generate an
   **app-specific password** for "Home Assistant".
2. In HA → *Settings → Devices & Services → Add Integration →
   CalDAV*. Server URL:
   ```
   https://caldav.icloud.com
   ```
   Username: your Apple ID. Password: the app-specific one.
3. HA discovers your iCloud calendars and reminder lists. Reminder
   lists show up as `todo.<list_name>` entities. Confirm under
   *Developer Tools → States*.

(Alternative: iOS Shortcut automation that POSTs to an HA webhook on
reminder change. More work, used only if CalDAV is flaky.)

## Creating the HA token

HA → your profile (bottom left) → **Long-Lived Access Tokens** →
*Create Token*. Name it "MagicMirror". Copy the token **once** (HA
only shows it on creation) and paste into `config.js` → `haToken`.

## Configure

```js
{
    module: "MMM-HA-Reminders",
    position: "top_left",
    classes: "Domes",
    config: {
        haUrl: "http://homeassistant.local:8123",
        haToken: "HA_TOKEN_PLACEHOLDER",     // real token lives only on the Pi
        todoEntities: ["todo.iphone_reminders"],   // one or more lists
        maxItems: 6,
        showDueDate: true,
        showCompleted: false,
        refreshSec: 60,
        language: "cs"                       // "cs" or "en"
    }
}
```

## Notes

- No npm dependencies — uses native `fetch` (Node 18+ / pm2).
- Token is scrubbed in this repo. The real token stays on the Pi.
- If HA is unreachable, the module shows the error text and keeps
  retrying on the next tick.
