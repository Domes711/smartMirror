# MMM-Lunch-Menu

Shows today's **lunch menus** for a few restaurants, scraped from
[menicka.cz](https://www.menicka.cz/) (Czech daily-menu portal, good Brno
coverage). Pages are server-rendered, so it parses HTML with `cheerio` — no
headless browser.

Two ways to choose restaurants (no mode flag — the filled field wins):

- **`restaurants`** set → show those (first `count`).
- otherwise → take the **nearest `count`** to `location`, by geocoding menicka
  restaurant addresses via **Nominatim/OpenStreetMap** (cached).

## Install

```bash
cd ~/smartMirror/MagicMirror/modules/MMM-Lunch-Menu
npm install            # installs cheerio
```

## Config

```js
{
  module: "MMM-Lunch-Menu",
  position: "top_left",
  config: {
    // Pick restaurants explicitly (menicka id or full URL). If non-empty, wins:
    restaurants: ["5396", "https://www.menicka.cz/1234-bistro-franz.html"],

    // ...or leave restaurants empty and use a location → nearest `count`:
    // location: { lat: 49.195, lon: 16.607 },
    // city: "brno",          // menicka city slug for the candidate list
    // nearbyPool: 20,         // how many city restaurants to scan for distance

    count: 4,                  // how many restaurants to fetch & show
    showSoup: true,
    showAllergens: true,
    showPrices: true,
    maxDishes: 0,              // 0 = all
    updateInterval: 3600000,   // hourly (menus are daily)
    userAgent: "MMM-Lunch-Menu (smart mirror, personal use)"
  }
}
```

To find a restaurant's id: open it on menicka.cz — the URL is
`https://www.menicka.cz/<ID>-<slug>.html`; the numeric `<ID>` is the key.

## How it works

- `node_helper.js` resolves the restaurants, fetches each menicka page and
  parses **today's** menu (soup + numbered dishes + allergens + price) via
  `lunch-parser.js`. Results are sent to the frontend over `LUNCH_MENU`.
- Nearby mode scans the city page's restaurant list, geocodes addresses
  (Nominatim, ≤1 req/s, cached to `geocode-cache.json`), and keeps the nearest
  `count`. It is **approximate** — only the first `nearbyPool` city restaurants
  are considered; for precision use `restaurants`.
- Refresh is hourly; on a failed fetch the last good result stays on screen.

## Notes / limitations

- Scraping = layout-dependent. `lunch-parser.js` is resilient and the parser is
  unit-tested (`npm test`); if menicka changes its markup, adjust the selectors
  there (`div.menicka` / `div.nadpis` / `div.polozka` / `div.cena`).
- Be polite: hourly re-scrape, descriptive User-Agent, Nominatim cached.
- `geocode-cache.json` is per-Pi (gitignored).

## Conventions

- `demo.html` renders sample restaurants offline — open via raw.githack:
  `https://raw.githack.com/Domes711/smartMirror/<branch>/MagicMirror/modules/MMM-Lunch-Menu/demo.html`
- `npm test` runs `lunch-parser.js` unit tests against an HTML fixture.
