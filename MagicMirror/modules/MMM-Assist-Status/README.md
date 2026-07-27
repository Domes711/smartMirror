# MMM-Assist-Status

Colour-wave visualisation of the voice-assistant state — the "the mirror is
listening to you" indicator. Sits directly under the recognised-user name (the
Face ID indicator), sharing its region.

Eight dots in the Google palette (blue, red, yellow, green, repeated) are drawn
on a `<canvas>`. Target shapes are computed every frame and the current values
**lerp** toward them, so the states morph into one another and never blink.

## States

Driven over MQTT (topic `mirror/assist/state`, retained). Payload is one of:

| State | Look |
|---|---|
| `idle` | Empty. Dots are above the canvas at zero opacity; nothing is drawn. Height stays reserved so the name above never jumps. |
| `listening` | Dots **flow in from the top** (55 ms stagger, left→right) then stretch into vertical bars driven by a simulated audio envelope. |
| `processing` | Dots orbit a **flattened** ellipse (not a circle — a circle reads as a "waiting for the web" spinner). |
| `responding` | Each dot **stretches into a waving line** across the full width (starts as a 6 px segment at the dot, expands and thins to 2.4 px). |
| `error` | Dots pull to centre, turn red and pulse slowly. |

Returning to `idle` runs the stagger in **reverse** (last dot leaves first).

## Install

```bash
cd ~/MagicMirror/modules/MMM-Assist-Status
npm install            # pulls in `mqtt`
```

## Config

```js
{
    id: "assist-status",
    module: "MMM-Assist-Status",
    config: {
        mqttBroker: "mqtt://127.0.0.1:1883",
        stateTopic: "mirror/assist/state",
        watchdogSec: 30,   // fall back to idle if no state change arrives
        height: 52         // canvas height in px
    }
}
```

Place it in the same region as, and **right after**, the user indicator so it
stacks under the name (or reference it that way in `config/pages.js`).

### Watchdog

If the state is anything other than `idle` and no new MQTT message arrives
within `watchdogSec` seconds, the module falls back to `idle`. This protects
against a stuck **retained** state (e.g. Home Assistant crashing mid-query).

## Test without Home Assistant

```bash
mosquitto_pub -t mirror/assist/state -r -m listening
mosquitto_pub -t mirror/assist/state -r -m idle
```

## Preview (no Pi)

Open `demo.html` — buttons switch between states. Live URL:

`https://raw.githack.com/Domes711/smartMirror/claude/nove-moduly-nhfzkd/MagicMirror/modules/MMM-Assist-Status/demo.html`

Render PNGs on the Pi:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node demo-render.js
```

## Conventions

- `suspend()` cancels the canvas loop so it stops burning CPU when the display
  is off; `resume()` restarts it.
- All colour lives in the canvas (JS palette). The CSS only reserves the strip.
- The Google palette / design tokens are shared with `MMM-AI-Display` via
  `css/custom.css`.
