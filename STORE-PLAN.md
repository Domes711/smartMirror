# Store — plán implementace

## Co děláme

Vytvoříme `mm-store.json` + screenshoty pro **všechny dostupné moduly**
(vlastní i komunitní ~1 400), uložíme do `store/modules/` v tomto repozitáři
a upravíme store aby je používal.

---

## Fáze 1 — Obsah: `store/modules/`

Struktura:
```
store/
  modules/
    MMM-Foo/
      mm-store.json
      screenshots/
        normal.png
        empty.png
```

### `mm-store.json` schéma

```json
{
  "name": {
    "en": "Weather Forecast",
    "cs": "Předpověď počasí"
  },
  "description": {
    "en": "Shows current weather and 5-day forecast on your mirror.",
    "cs": "Zobrazí aktuální počasí a předpověď na 5 dní."
  },
  "screenshots": [
    "screenshots/normal.png",
    "screenshots/empty.png"
  ],
  "scope": "per-user",
  "tags": ["weather", "forecast"],
  "wizard": [
    {
      "key": "apiKey",
      "label": { "en": "API Key", "cs": "API klíč" },
      "type": "password",
      "required": true,
      "help": { "en": "Free key from openweathermap.org", "cs": "Zdarma na openweathermap.org" }
    }
  ]
}
```

### 1-A  Vlastní moduly (8 ks) — plné zpracování

Claude přečte zdrojový kód + README každého modulu a vygeneruje `mm-store.json`.
Screenshoty: 2 různé stavy přes Playwright z `demo.html`.
Pro moduly bez `demo.html` (MMM-GoogleCalendar, MMM-Lunch-Menu) nejdřív vytvořit.

- [ ] MMM-Brno-Transit
- [ ] MMM-GoogleCalendar  *(+ demo.html)*
- [ ] MMM-HA-Reminders
- [ ] MMM-Lunch-Menu  *(+ demo.html)*
- [ ] MMM-Mail
- [ ] MMM-Package-Tracker
- [ ] MMM-Profile
- [ ] MMM-Spending

### 1-B  Komunitní moduly (~1 400 ks) — batch zpracování

Pro každý modul z katalogu Claude:
1. Fetchne README z GitHub raw URL
2. Analyzuje konfiguraci (defaults, README config sekce)
3. Vygeneruje `mm-store.json` (name + description cs/en, wizard pole)

Screenshoty komunitních modulů:
- Primárně: obrázek z katalogu (`modules.magicmirror.builders/images/`) → uložit jako `screenshots/normal.png`
- Pokud katalog obrázek nemá → prázdná složka, store zobrazí placeholder

Dávkově po ~100 modulech, lze spouštět na pozadí.

---

## Fáze 2 — Backend

### 2-A  Static route  (`mirror-console/server/index.js`)

```js
app.use("/store-assets", express.static(path.join(REPO_ROOT, "store", "modules")));
```

`vite.config.js` + `server/index.js` proxy: přidat `/store-assets`.

### 2-B  Merge logika  (`mirror-console/backend/supervisor.py`)

Nová konstanta:
```python
STORE_MODULES_DIR = os.path.join(REPO_ROOT, "store", "modules")
```

Funkce `_load_local_meta(name)` — načte `store/modules/<name>/mm-store.json`.

Merge v `store_catalog(lang)`:
```
name        = local[lang] || local["en"] || catalog.name
description = local[lang] || local["en"] || catalog.description  
screenshots = local screenshots jako /store-assets URLs
              + catalog.image jako fallback pokud local chybí
wizard      = local.wizard || []
scope       = local.scope || "per-user"
```

`GET /store/catalog?lang=cs` — server přeloží pole, frontend dostane čisté stringy.

### 2-C  Wizard pole v `/modules`

`list_modules()` obohatit o `wizard` z lokálních metadat.

---

## Fáze 3 — Frontend

### 3-A  Přeložené názvy a popisky

`ModuleCard` + `ModuleDetail` zobrazují `m.name` a `m.description`
(přijdou již přeložené ze serveru).

`ModuleStorePanel` fetchuje `/store/catalog?lang=<mirrorLanguage()>`.

### 3-B  Wizard komponenta  (`web/src/StoreWizard.jsx`)

Modal s formulářem generovaným z `module.wizard[]`.
Typy: `text`, `password`, `select`, `number`, `toggle`, `url`.
Každé pole: `label`, volitelně `help` pod inputem.
Validace required polí před potvrzením.

### 3-C  Wizard v Rozložení editoru

Po přidání modulu na pozici v layoutu:
1. Má modul `wizard` pole? → zobraz `<StoreWizard>` jako modal
2. Po potvrzení → ulož `values` do instance v layout store
3. Zavři modal, modul je na pozici s konfigurací

---

## Pořadí práce

1. Fáze 1-A — vlastní moduly (mm-store.json + demo.html + screenshoty)
2. Fáze 2-A+B — backend static route + merge logika
3. Fáze 3-A — přeložené názvy (rychlé)
4. Fáze 1-B — komunitní moduly v dávkách na pozadí (může běžet paralelně)
5. Fáze 3-B+C — Wizard komponenta + integrace do editoru
