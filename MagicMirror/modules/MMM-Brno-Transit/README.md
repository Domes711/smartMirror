# MMM-Brno-Transit

Shows next departures from a Brno IDS JMK stop. Two data sources in
combination:

- **GTFS static** from [data.brno.cz](https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328)
  for scheduled departures (no key, no scraping).
- **Real-time vehicle stream** (ArcGIS StreamServer on `gis.brno.cz`) for
  live delays; a small dot next to the time marks departures where a
  matching vehicle is active. Falls back to scheduled-only if the
  stream is unavailable.

Mode (tram / bus / trolleybus / rail) is auto-derived from GTFS
`route_type`, you don't put it in config.

Black-and-white, MagicMirror look. See `preview.html` for a static
design mock (variants A-G) that opens in any browser.

## Install (on the Pi)

```bash
cd ~/MagicMirror/modules/MMM-Brno-Transit
npm install        # pulls adm-zip + ws
```

## Configure

Get the current direct GTFS .zip URL: open the dataset page above, click
**Download**, copy the link. Paste it into `gtfsUrl` below.

```js
{
    module: "MMM-Brno-Transit",
    position: "top_right",
    config: {
        stopName: "Vlhká",                // human name; matched case-insensitive
        // stopId: "U1670Z1P",            // optional GTFS stop_id override
        gtfsUrl: "https://data.brno.cz/.../gtfs.zip",
        gtfsRefreshHours: 168,            // re-download GTFS once a week
        refreshSec: 60,                   // recompute next departures every minute
        perLine: 2,                       // how many upcoming departures per line
        // realtimeUrl, vehicleTtlSec — optional, defaults work for Brno
        lines: [
            { line: "9",  directionId: 0 },
            { line: "67", directionId: 1 }
        ]
    }
}
```

## Picking `directionId`

GTFS uses `direction_id` 0/1 per route — which one matches your commute
direction depends on the feed. On startup the helper logs every direction
it found at your stop:

```
[MMM-Brno-Transit] directions found at Vlhká:
  line 9, directionId 0 → "Štefánikova čtvrť"
  line 9, directionId 1 → "Juliánov"
  line 67, directionId 0 → "Stránská skála"
  line 67, directionId 1 → "Slatina, sídliště"
```

Pick the one with the headsign you actually take.

## Cache

On first run the helper downloads the GTFS zip, extracts the 6 files
it needs, parses them into a slim in-memory index (just your lines /
your stop), writes `cache/compiled.json` + `cache/meta.json`, and
**deletes the zip + raw .txt files**. Steady-state footprint is a few
MB instead of ~250 MB. Boot after the first run loads `compiled.json`
directly — no parsing, near-instant.

`compiled.json` is invalidated automatically if you change
`stopName`, `stopId`, `lines`, or `gtfsUrl` in config, or when
`gtfsRefreshHours` elapses. Safe to delete `cache/` — it'll rebuild.
