# MMM-Brno-Transit

Shows next departures from a Brno IDS JMK stop. Uses the official GTFS
schedule from [data.brno.cz](https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328)
— no scraping, no API key. Mode (tram / bus / trolleybus / rail) is
auto-derived from GTFS `route_type`, you don't put it in config.

Black-and-white, MagicMirror look. See `preview.html` for a static
design mock that opens in any browser.

## Install (on the Pi)

```bash
cd ~/MagicMirror/modules/MMM-Brno-Transit
npm install        # pulls adm-zip
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

GTFS zip + extracted .txt files live under `cache/`. The directory is
created on first run and refreshed every `gtfsRefreshHours`. Safe to
delete — it'll be re-downloaded.
