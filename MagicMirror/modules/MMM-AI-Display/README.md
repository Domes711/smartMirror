# MMM-AI-Display

The answer panel for the Gemini voice assistant. Home Assistant publishes a
payload over MQTT; the panel slides in from the top, renders the content, and
slides back up after a TTL.

- **Black background**, panel floats on it with a white rounded frame.
- **Static four-colour Google shadow** in the corners (blue LT, red RT, yellow
  RB, green LB) — no animation; it appears/disappears with the panel.
- Slides in from **88 px above** with an overshoot (580 ms) and leaves the same
  way — the same direction things arrive from in `MMM-Assist-Status`.

## Render modes

The panel has two ways to render the `html` it receives, chosen by
`config.renderMode`:

### `"sandbox"` (default) — renders **any** HTML + CSS + JS

The content is dropped into a **sandboxed `<iframe srcdoc>`** with
`sandbox="allow-scripts"` and **no** `allow-same-origin`. Consequences:

- **Scripts run, CSS is unrestricted, any HTML renders** — Gemini has full
  freedom (charts, animations, colours, `<script>`, `<style>`, whatever).
- The content lives in an **opaque origin**: it **cannot** reach the mirror's
  DOM, `socket.io`, cookies or storage. So "run everything" is *not* an XSS hole
  into the mirror — the worst the content can do is misbehave inside its own box.
- The iframe **auto-sizes** to its content (a tiny height reporter is injected
  into the srcdoc and `postMessage`s its `scrollHeight` up; capped at
  `maxHeightPx`).
- Base styling matches the panel (black background, white text, Roboto), which
  the content's own CSS can override. The `aid-*` catalog below is still
  available inside the iframe, so existing `aid-*` payloads keep their look.
- When the panel hides, the iframe is blanked so its JS stops (no timers running
  behind a dark screen).

> **Trade-off:** maximum freedom, but Gemini can now produce colour/layout that
> may not match the rest of the mirror. If you want the old visual guarantee,
> use `"strict"`.

### `"strict"` — the `aid-*` design system (no scripts, no free CSS)

The HTML is run through a whitelist **sanitizer**: only the `aid-*` catalog
survives. Gemini supplies semantics + numbers only; all styling is the module's.

1. Tags whitelist: `div span b p ul li table thead tbody tr th td img svg polyline polygon circle g text`.
2. Attributes whitelist: `class style src alt viewBox preserveAspectRatio points pathLength x y cx cy r colspan`.
3. `class` — only `aid-*` tokens kept.
4. `style` — only `--name: number[%]` declarations survive (`--v:64` ok; `color:red`, `position:fixed` dropped).
5. `src` — only if it starts with an allowlisted prefix (`imgAllowlist`, default `mirror.local`); else the `<img>` is removed.
6. A leading ```` ```html ```` markdown fence is stripped first.

**Fallback (both modes):** the `text` field is a plain-text backup. If `html` is
empty it is rendered (escaped) as an `aid-note`.

## Class catalog (design system, available in both modes)

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
        renderMode: "sandbox",   // "sandbox" = any HTML/CSS/JS | "strict" = aid-* only
        maxHeightPx: 1400,       // sandbox: cap the auto-sized iframe height
        imgAllowlist: ["mirror.local"], // strict mode only
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
# aid-* content
mosquitto_pub -t mirror/display/set -m '{"title":"TEST","html":"<div class=\"aid-big\">42</div>","text":"42","ttl":20}'
# sandbox mode: live JS runs
mosquitto_pub -t mirror/display/set -m '{"title":"JS","html":"<div id=c style=\"font-size:3em\">0</div><script>let n=0;setInterval(()=>c.textContent=++n,1000)<\/script>","text":"0","ttl":20}'
mosquitto_pub -t mirror/display/clear -m x
```

## Home Assistant wiring

See [`docs/home-assistant/mirror-assist.md`](../../../docs/home-assistant/mirror-assist.md)
for the automation (assistant state → MQTT), the `zobraz_na_zrcadle` script
(the Gemini tool), and the expose/prompt steps.

> In **strict** mode the `aid-*` catalog lives in two places — this module's CSS
> **and** the HA script `description`. Change both together. In **sandbox** mode
> the catalog is optional guidance (Gemini can emit anything), but keeping it in
> the prompt still gives a consistent look.

## Preview (no Pi)

Open `demo.html` — scene buttons including a **▸ Živý JS** counter (proves
scripts run inside the panel) and a **Vlastní CSS** gradient (proves free CSS).
Live URL:

`https://raw.githack.com/Domes711/smartMirror/claude/nove-moduly-nhfzkd/MagicMirror/modules/MMM-AI-Display/demo.html`

Render PNGs on the Pi:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node demo-render.js
```

## Conventions

- `suspend()` clears the TTL/clock timers, hides the panel and blanks the
  sandbox iframe so no content JS runs behind a dark screen.
- Content swaps always go **through a close** (close → 360 ms → rewrite → open),
  never a rewrite under an open panel. In sandbox mode each swap builds a fresh
  iframe, so the previous answer's JS/timers are fully torn down.
- Security boundary: sandbox content is `allow-scripts` **without**
  `allow-same-origin` — it can never touch the mirror. Never add
  `allow-same-origin` (combined with `allow-scripts` it lets the content escape
  the sandbox).
