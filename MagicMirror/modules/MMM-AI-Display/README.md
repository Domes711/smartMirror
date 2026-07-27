# MMM-AI-Display

The answer panel for the Gemini voice assistant. Home Assistant publishes a
payload over MQTT; the panel slides in from the top, renders the content, and
slides back up after a TTL.

- **Black background**, panel floats on it with a white rounded frame.
- **Static four-colour Google shadow** in the corners (blue LT, red RT, yellow
  RB, green LB) — no animation; it appears/disappears with the panel.
- Slides in from **88 px above** with an overshoot (580 ms) and leaves the same
  way — the same direction things arrive from in `MMM-Assist-Status`.

## The contract: Gemini supplies data, never style

**Gemini must not decide colour, font, size or position** — only semantics and
numbers. All styling lives in this module's CSS (the `aid-*` classes). The only
colourful element inside the panel is `aid-img`.

The incoming HTML is run through a **mandatory sanitizer** before it touches
`innerHTML`:

1. Tags whitelist: `div span b p ul li table thead tbody tr th td img svg polyline polygon circle g text`. Anything else is dropped.
2. Attributes whitelist: `class style src alt viewBox preserveAspectRatio points pathLength x y cx cy r colspan`.
3. `class` — only `aid-*` tokens are kept.
4. `style` — only `--name: number[%]` declarations survive (`--v:64` ok; `color:red`, `position:fixed` dropped).
5. `src` — only if it starts with an allowlisted prefix (`imgAllowlist`, default `mirror.local`); otherwise the `<img>` is removed.
6. A leading ```` ```html ```` markdown fence is stripped first.

**Fallback:** the `text` field is required. If the sanitized body is empty
(Gemini returned something the contract can't survive), `text` is rendered as an
`aid-note`.

## Class catalog (design system)

| Class | Purpose | Controllable via style |
|---|---|---|
| `aid-big` | one large number | — |
| `aid-note` | small grey text | — |
| `aid-kv` | key–value row (`<span>` + `<b>`) | — |
| `aid-table` | table | — |
| `aid-bar` | horizontal bar | `--v` (0–100) |
| `aid-line` | line chart (`<svg><polyline>`) | points in `points` |
| `aid-donut` | pie (`<svg>` + `<circle class="aid-slice">`) | `--pct`, `--off` per slice |
| `aid-legend` | legend for the donut | — |
| `aid-img` | full-colour image | `src` (allowlist only) |
| `aid-row` | two elements side by side | — |

For a donut, `--off` = the sum of all preceding `--pct`. `aid-line polyline`
**must** carry `vector-effect:non-scaling-stroke`.

## Install

```bash
cd ~/MagicMirror/modules/MMM-AI-Display
npm install            # pulls in `mqtt`
```

## Config

```js
{
    id: "ai-display",
    module: "MMM-AI-Display",
    config: {
        mqttBroker: "mqtt://127.0.0.1:1883",
        setTopic: "mirror/display/set",
        clearTopic: "mirror/display/clear",
        availabilityTopic: "mirror/display/availability",
        defaultTitle: "ASISTENT",
        defaultTtl: 60,          // seconds; capped at maxTtl
        maxTtl: 900,
        imgAllowlist: ["mirror.local"],
        shadow: true,
        language: "cs"
    }
}
```

## MQTT topics

| Topic | Retain | Payload | Direction |
|---|---|---|---|
| `mirror/display/set` | no | JSON `{title, html, text, ttl}` | HA → module |
| `mirror/display/clear` | no | anything (trigger) | HA → module |
| `mirror/display/availability` | yes | `online` \| `offline` (LWT) | module → HA |

## Test without Home Assistant

```bash
mosquitto_pub -t mirror/display/set -m '{"title":"TEST","html":"<div class=\"aid-big\">42</div>","text":"42","ttl":20}'
mosquitto_pub -t mirror/display/clear -m x
```

## Home Assistant wiring

See [`docs/home-assistant/mirror-assist.md`](../../../docs/home-assistant/mirror-assist.md)
for the automation (assistant state → MQTT), the `zobraz_na_zrcadle` script
(the Gemini tool, carrying the full class catalog in its `description`), and the
expose/prompt steps.

> **The catalog lives in two places** — this module's CSS **and** the HA script
> `description`. Change both together: a class Gemini doesn't know about is
> useless, and one the CSS doesn't style is broken.

## Preview (no Pi)

Open `demo.html` — scene buttons plus a **⚠ Sanitizer** torture test that proves
`<script>`, `style="color:red"`, `onclick`, `<a>`, `<marquee>` and a blocked
`<img src>` are all stripped. Live URL:

`https://raw.githack.com/Domes711/smartMirror/claude/nove-moduly-nhfzkd/MagicMirror/modules/MMM-AI-Display/demo.html`

Render PNGs on the Pi:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node demo-render.js
```

## Conventions

- `suspend()` clears the TTL/clock timers and hides the panel so nothing runs
  behind a dark screen.
- Content swaps always go **through a close** (close → 360 ms → rewrite → open),
  never a rewrite under an open panel.
