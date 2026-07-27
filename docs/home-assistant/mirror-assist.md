# Home Assistant wiring — mirror voice assistant

Connects the Wyoming/Gemini voice pipeline to the two mirror modules over the
MQTT broker HA already uses. Two flows:

- **assistant state → `MMM-Assist-Status`** (the colour-wave indicator)
- **Gemini answer → `MMM-AI-Display`** (the answer panel)

## Topics

| Topic | Retain | Payload | Direction |
|---|---|---|---|
| `mirror/assist/state` | **yes** | `idle` \| `listening` \| `processing` \| `responding` \| `error` | HA → status module |
| `mirror/display/set` | no | JSON `{title, html, text, ttl}` | HA → panel module |
| `mirror/display/clear` | no | anything (trigger) | HA → panel module |
| `mirror/display/availability` | yes | `online` \| `offline` (LWT) | panel module → HA |

`retain` on the state means the indicator re-syncs immediately after a mirror
restart.

## 1. Automation: assistant state → MQTT

Wyoming exposes the pipeline as `assist_satellite.*`. Mirror its state onto the
topic. `mode: queued` because states change in quick succession.

```yaml
alias: Mirror – assistant state to MQTT
mode: queued
max: 10
triggers:
  - trigger: state
    entity_id: assist_satellite.mirror   # adjust to your satellite entity
actions:
  - action: mqtt.publish
    data:
      topic: mirror/assist/state
      retain: true
      qos: 1
      payload: "{{ trigger.to_state.state }}"
```

The entity reports `idle`/`listening`/`processing`/`responding`. Publish
`error` separately where you need it (e.g. a pipeline-error automation).

## 2. Script `zobraz_na_zrcadle` (the Gemini tool)

`tojson` handles escaping the quotes inside the HTML — without it the JSON
breaks on the first attribute.

```yaml
alias: Zobraz na zrcadle
description: >-
  Zobrazí vizuální obsah na chytrém zrcadle. Volej vždy, když uživatel chce
  něco "zobrazit"/"ukázat", nebo když je odpověď příliš dlouhá/strukturovaná
  na předčítání (seznamy, srovnání, čísla, trendy). Zároveň VŽDY odpověz
  krátkou mluvenou větou. Nikdy nečti HTML nahlas. Na krátké faktické dotazy
  ("Kolik je hodin?") tool NEVOLEJ.
fields:
  title:
    description: Nadpis panelu (velkými). Default "ASISTENT".
    example: POČASÍ
  html:
    description: >-
      Obsah panelu. Používej VÝHRADNĚ tyto třídy (prefix aid-), nikdy neurčuj
      barvy, fonty ani velikosti — ty řídí zrcadlo:
        aid-big    = jedno velké číslo:            <div class="aid-big">18°</div>
        aid-note   = malý šedý popisek:            <div class="aid-note">Déšť se nečeká.</div>
        aid-kv     = řádek klíč–hodnota:           <div class="aid-kv"><span>Ráno</span><b>11°</b></div>
        aid-table  = tabulka:                      <table class="aid-table"><tr><th>Linka</th><th>Odjezd</th></tr><tr><td>9</td><td>3 min</td></tr></table>
        aid-bar    = vodorovný sloupec (--v 0–100):<div class="aid-bar" style="--v:68"><span>Út</span><b>6 840</b></div>
        aid-line   = spojitý graf:                 <svg class="aid-line" viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="0,30 50,12 100,14"/></svg>
        aid-donut  = koláč (--pct, --off=součet předchozích pct):
                     <svg class="aid-donut" viewBox="0 0 42 42"><circle class="aid-slice" pathLength="100" style="--pct:38;--off:0"/><circle class="aid-slice" pathLength="100" style="--pct:28;--off:38"/></svg>
        aid-legend = legenda k donutu:             <div class="aid-legend"><span>Práce 38 %</span></div>
        aid-img    = obrázek (jen z povolené domény): <img class="aid-img" src="http://mirror.local/x.png">
        aid-row    = dva prvky vedle sebe:         <div class="aid-row">…</div>
      Vyber formu podle dat: trend v čase → aid-line, podíly z celku → aid-donut,
      srovnání kategorií → aid-bar, výčet → aid-table/aid-kv, jedno číslo → aid-big,
      obrázek → aid-img. Max 6 řádků/položek. Nikdy neurčuj barvy/fonty/velikosti.
    example: '<div class="aid-big">18°</div><div class="aid-note">Brno</div>'
  text:
    description: Záložní prostý text, když se HTML nepovede. Vyplň vždy.
    example: V Brně je 18 stupňů, polojasno.
  ttl:
    description: Za kolik sekund panel zmizí (5–900, default 60).
    example: 60
sequence:
  - action: mqtt.publish
    data:
      topic: mirror/display/set
      payload: >-
        {"title": {{ (title|default('ASISTENT'))|tojson }},
         "html": {{ html|tojson }},
         "text": {{ (text|default(''))|tojson }},
         "ttl": {{ (ttl|default(60))|int }}}
```

## 3. Expose the script to Assist

Nastavení → Hlasoví asistenti → Vystavit → add `script.zobraz_na_zrcadle`.
**Without this Gemini never sees the tool** — the most common "it doesn't work".

## 4. Gemini integration

Google Generative AI → Nastavit → **Control Home Assistant: Assist**. Add to the
prompt when to call the tool and when not to (see the `description` above +
"na krátké faktické dotazy tool nevolej"). Flash variants handle tool-calling.

## Testing (incremental)

```bash
# status module
mosquitto_pub -t mirror/assist/state -r -m listening
mosquitto_pub -t mirror/assist/state -r -m idle

# panel module
mosquitto_pub -t mirror/display/set -m '{"title":"TEST","html":"<div class=\"aid-big\">42</div>","text":"42","ttl":20}'
mosquitto_pub -t mirror/display/clear -m x
```

Then HA Developer tools → Actions → run `script.zobraz_na_zrcadle`. Finally test
by voice, including the **negative** case ("Kolik je hodin?" → the tool must
**not** be called).

> **Render modes.** `MMM-AI-Display` defaults to `renderMode: "sandbox"`, which
> renders **any HTML/CSS/JS** Gemini returns (isolated in a sandboxed iframe that
> can't touch the mirror). There the catalog above is *optional* guidance — keep
> it in the prompt for a consistent look, but Gemini may also emit its own
> charts/CSS/scripts. If the module is set to `renderMode: "strict"`, only the
> `aid-*` catalog survives a sanitizer, and then the catalog **must** stay in
> sync between the module CSS (`MMM-AI-Display.css`) and this script's
> `description` — a class in only one place is useless.
