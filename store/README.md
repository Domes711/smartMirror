# Module Store — curated metadata

Per-module store metadata + screenshots, merged into the live catalog by the
console backend (`mirror-console/backend/supervisor.py`). Provides localized
names/descriptions and a typed config **wizard** on top of the bare community
catalog at `modules.magicmirror.builders`.

## Layout

```
store/modules/<MMM-Name>/
  mm-store.json          # localized name/description + wizard schema
  screenshots/           # generated on the Pi (see below)
    normal.png
    empty.png
```

## `mm-store.json` schema

```jsonc
{
  "name":        { "en": "…", "cs": "…" },
  "description": { "en": "…", "cs": "…" },
  "screenshots": ["screenshots/normal.png", "screenshots/empty.png"],
  "scope":       "per-user",          // "per-user" | "global"
  "tags":        ["…"],
  "wizard": [                          // typed config form, in field order
    {
      "key":      "haToken",           // module config key (must match defaults)
      "label":    { "en": "…", "cs": "…" },
      "type":     "password",          // text|password|number|select|toggle|url
      "required": true,
      "default":  "…",                 // optional
      "options":  [ { "value": "cs", "label": { "en": "…", "cs": "…" } } ],
      "help":     { "en": "…", "cs": "…" }
    }
  ]
}
```

The backend localizes these to plain strings per request (`?lang=cs|en`) and
exposes them via `/store/catalog` (cards + detail) and `/modules` (the layout
editor's "fill config" form).

## Screenshots

Served at `/store-assets/<MMM-Name>/screenshots/<file>` by the Express front-end
(`mirror-console/server/index.js`). The first screenshot becomes the card
thumbnail. They are **generated on the Pi** from each module's `demo.html` with
Playwright (the console has a system-wide install), e.g.:

```bash
cd ~/smartMirror/MagicMirror/modules/MMM-Foo
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node /opt/node22/bin/node demo-render.js
# then copy render-*.png → ~/smartMirror/store/modules/MMM-Foo/screenshots/
```

Missing screenshot files degrade gracefully: the catalog falls back to the
community image (community modules) or the 🪞 placeholder (own modules).
