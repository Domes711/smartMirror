# smartMirror — kompletní technický popis projektu

> Maximálně podrobný popis celého projektu: hardware, architektura, datový tok,
> všechny komponenty, moduly, MQTT témata, API a provozní postupy.
>
> Stav repozitáře k datu generování. Pi je „source of truth"; tento repozitář
> je runnable záloha kódu + designové specifikace. Per-Pi runtime stav
> (kalibrace radaru, layout store, vendored závislosti) je `gitignored`.

---

## 1. Co to je

**smartMirror** je chytré zrcadlo postavené nad [MagicMirror²](https://magicmirror.builders/)
běžící na **Raspberry Pi**. Oproti běžné MagicMirror instalaci přidává:

- **Detekci přítomnosti** mmWave radarem (HLK-LD2450) → zapíná/vypíná displej.
- **Rozpoznávání obličeje** kamerou → přepíná **profily** (každý uživatel vidí
  jiné moduly).
- **Časově řízený layout** — co se zobrazí, závisí na `(uživatel, časové okno)`.
- **Webovou konzoli** (`mirror-console`) na portu `:8000` pro správu kamery,
  profilů, layoutů, radaru, MQTT a pro **stavbu nových modulů přes AI** (Claude
  Agent SDK).

Celý systém je **event-driven** přes MQTT — není to always-on polling. Radar
ohlásí přítomnost → kamera zkusí rozpoznat obličej → jádro MagicMirror přepne
layout odpovídající profilu a aktuálnímu času.

---

## 2. Cílový hardware

| Prvek | Detail |
|---|---|
| **Raspberry Pi** | `admin@10.0.0.249` (SSH) |
| **MagicMirror root** | `~/smartMirror/MagicMirror/` (jediný zdroj = tento klon) |
| **Kamera** | RPi Camera Module (ribbon) — rozpoznávání obličeje |
| **Radar** | HLK-LD2450 na UART `/dev/ttyAMA0` @ **256000 baud** |
| **Relé** | **GPIO17** → tlačítko napájení displeje (zapnutí/vypnutí dle přítomnosti) |

Porty a sběrnice:

| Služba | Port / sběrnice | Dostupnost |
|---|---|---|
| MagicMirror (web) | `:8080` | LAN |
| mirror-console web | `:8000` | LAN (`0.0.0.0`) |
| supervisor (kamera) | `:8001` | jen localhost |
| MQTT broker (mosquitto) | `:1883` | localhost |
| UART radar | `/dev/ttyAMA0` @ 256000 | hardware |
| GPIO relé | GPIO17 | hardware |

---

## 3. Architektura a datový tok

```
┌───────────────────────────────────────────────────────────────────────┐
│  Raspberry Pi                                                           │
│                                                                         │
│  ┌──────────────┐   UART /dev/ttyAMA0 256000                           │
│  │  HLK-LD2450  │──────────────┐                                       │
│  └──────────────┘              ▼                                       │
│                        ┌─────────────────┐  GPIO17 puls 100 ms         │
│                        │ ld2450_daemon.py│──────────► relé displeje    │
│                        │ (systemd ld2450)│                             │
│                        └────────┬────────┘                             │
│                                 │ MQTT                                  │
│         smartmirror/radar/presence  (present|absent)                   │
│         smartmirror/radar/targets   (live ~10 Hz)                      │
│         smartmirror/radar/control / config                             │
│                                 │                                       │
│                       ┌─────────▼──────────┐                           │
│   ┌──────────┐        │  mosquitto :1883   │                           │
│   │ RPi kamera│       └──┬──────────────┬──┘                           │
│   └────┬─────┘          │              │                              │
│        │  arbitr        │              │                              │
│  ┌─────▼──────────┐     │              │                              │
│  │ supervisor.py  │     │              │ smartmirror/camera/recognition│
│  │  :8001 (arbitr)│     │              │ ({user} | {user:null})        │
│  └─────┬──────────┘     │              ▼                              │
│        │ spouští    ┌───┴──────────────────────┐                      │
│        │ face_reco  │ face_reco_daemon.py       │                      │
│        └───────────►│ (systemd face_reco, off)  │                      │
│                     └───────────────────────────┘                      │
│                                 │                                       │
│  ┌──────────────────────────────▼─────────────────────────────────┐  │
│  │  MagicMirror (pm2)  — vendored fork                             │  │
│  │   js/profile.js  ProfileManager (stavový automat + layout)      │  │
│  │     ── socket.io PROFILE_STATE / PROFILE_PREVIEW ──►            │  │
│  │   js/main.js     projectLayout() + Face ID indikátor           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  mirror-console  Express :8000  ◄─► supervisor :8001          │    │
│  │   React web (Kamera/Profily/Radar/MQTT/Moduly AI)             │    │
│  └──────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

### Krok za krokem

1. **`ld2450/ld2450_daemon.py`** čte radarové rámce z UART, filtruje cíle do
   obdélníkové zóny (`|x| ≤ 400 mm` **AND** `0 < y ≤ 1500 mm`). Při vstupu do
   zóny (debounce 3 rámce) → `present`, při 60 s bez cíle → `absent`. Na přechodu
   pulzuje GPIO17 (100 ms) a publikuje `smartmirror/radar/presence`.
2. **`camera/face_reco_daemon.py`** poslouchá `presence`. Na `present` skenuje
   kameru (max ~3 s, HOG model, tolerance 0.6) proti `encoded_faces.pickle` a
   publikuje `smartmirror/camera/recognition` = `{"user":"…"}` nebo `{"user":null}`.
3. **`MagicMirror/js/profile.js`** (`ProfileManager`) odebírá MQTT témata, běží
   stavový automat (`asleep` / `scanning` / `user` / `dimming`), z `config/pages.js`
   vyřeší aktivní layout a vysílá `PROFILE_STATE` přes socket.io.
4. **`MagicMirror/js/main.js`** přijme `PROFILE_STATE`, vykreslí Face ID indikátor
   (`top_center`) a `projectLayout()` přesune každý modul s `id` do regionu z
   aktivního layoutu.

---

## 4. Struktura repozitáře

```
smartMirror/
├── CLAUDE.md                 # instrukce pro Claude Code + autoritativní popis
├── README.md
├── STORE-PLAN.md             # roadmapa Module Store
├── setup.sh                  # master instalátor (self-bootstrap; chainuje komponenty)
├── deploy.sh                 # rolling update (git pull + rebuild + restart služeb)
├── deploy-to-pi.sh           # legacy: rsync modulů na Pi
├── cleanup-pi.sh             # reset (zachová repo) + záloha config/faces/state
├── nuke-pi.sh                # totální reset (smaže i ~/smartMirror)
├── .gitignore
│
├── docs/superpowers/
│   ├── specs/                # schválené design specy (8×)
│   └── plans/                # task-by-task plány s checkboxy (6×)
│
├── camera/                   # face recognition daemon + trénink
├── ld2450/                   # radar daemon + testy + systemd unit
├── mirror-console/           # web konzole (React + Express + Python supervisor)
├── tests/                    # face-id-animation.html (kanonická reference animace)
│
└── MagicMirror/              # VENDORED FORK jádra MagicMirror² v2.36.0
    ├── js/profile.js         # ★ celý profilový systém (ProfileManager)
    ├── js/main.js            # ★ projectLayout + Face ID + hot-load
    ├── js/app.js             # ★ + ProfileManager start + /module/hot-load route
    ├── js/loader.js          # ★ + per-instance id + hotLoadModule
    ├── css/profile.css       # ★ styly Face ID indikátoru
    ├── config/config.js      # zrcadlo Pi config.js (s MIRROR-CONSOLE markery)
    ├── config/pages.js       # GENEROVANÝ layout (gitignored — vytváří konzole)
    └── modules/MMM-*         # naše vlastní moduly
```

★ = soubory, kde se náš fork liší od upstreamu (viz §9).

---

## 5. Jádro: profilový systém (`MagicMirror/js/profile.js`)

`ProfileManager` je správce stavu a layoutu žijící **přímo v jádře** (ne jako
modul — starý `modules/MMM-Profile/` je legacy/retired, design spec ale zůstává
referencí).

### Stavový automat

| Stav | Význam |
|---|---|
| `asleep` | displej zhasnutý, nikdo přítomen |
| `scanning` | detekována přítomnost, čeká se na rozpoznání obličeje |
| `user` | obličej rozpoznán (nebo fallback `default`) |
| `dimming` | přítomnost zmizela, čeká se timeout do `asleep` |

### MQTT témata

| Téma | Směr | Payload |
|---|---|---|
| `smartmirror/radar/presence` | odběr | `present` / `absent` |
| `smartmirror/camera/recognition` | odběr | `{"user":"Domes"}` / `{"user":null}` |
| `smartmirror/camera/gesture` | odběr | gesto (volitelně) |
| `smartmirror/control/reset` | odběr | reset do `asleep` |

### Vyřešení layoutu

- Při `asleep`/`scanning` nebo bez rozpoznaného uživatele → klíč uživatele = `default`.
- Jinak v `pages.js[userKey]` hledá **aktivní časové okno**: okno = `from`/`to`
  jako 5-poľný cron (`min hour dom month dow`, 0 = neděle). Aktivní je to okno,
  jehož `from` „vystřelil" naposledy **a zároveň** později než jeho `to`. Při
  shodě vyhrává nejnovější `from`.
- Pokud žádné okno není aktivní → `defaults[userKey]` (per-uživatelský fallback).

### Výstup po socket.io

- **`PROFILE_STATE`** `{ state, currentUser, layout }` — do všech klientů.
- **`PROFILE_PREVIEW`** `{ layout }` — živý náhled z konzole (jen přemístí layout,
  nemění stav).

### Konfigurace (blok `profile` v `config.js`)

| Klíč | Default | Význam |
|---|---|---|
| `mqttBroker` | `mqtt://127.0.0.1:1883` | adresa brokeru |
| `defaultUser` | `default` | fallback profil |
| `dimTimeoutMs` | `60000` | čas `dimming` → `asleep` |

---

## 6. Kontrakt modulů: `config.js` + `pages.js`

### `config.js` (v repu minimální testovací varianta)

- Každý modul, který se má zobrazovat a přemísťovat, nese vlastní pole **`id`**.
- Pole **`position` se zcela ignoruje** — umístění řídí výhradně `pages.js`.
- Modul **bez `id`** se nikdy region-neumisťuje (overlay moduly jako `alert`
  fungují přes vlastní mechanismus → `id` nepotřebují).
- Spravované instance modulů z layout editoru se **auto-injektují** mezi markery:

```js
modules: [
    // MIRROR-CONSOLE:START (auto-managed — neupravovat)
    // MIRROR-CONSOLE:END

    { module: "alert" },                       // bez id → vždy viditelný overlay

    { id: "clock", module: "clock", config: { displaySeconds: false } },
    { id: "google-calendar", module: "MMM-GoogleCalendar", config: { calendars: [...] } }
]
```

> Verze v repu (`MagicMirror/config/config.js`) je vědomě **minimální testovací
> config** (jen `clock` + `MMM-GoogleCalendar` + `alert`). Reálný Pi config je
> bohatší a hand-maintained mimo MIRROR-CONSOLE blok.

### `pages.js` (generovaný, `gitignored`)

Schéma:

```js
module.exports = {
    defaults: {
        "default": [ { id, position }, ... ],   // fallback bez aktivního okna
        "Domes":   [ { id, position }, ... ]
    },
    "Domes": {
        "rano": {
            from: "0 6 * * 1-5",                 // 5-poľný cron
            to:   "0 10 * * 1-5",
            layout: [ { id, position }, ... ]
        }
    }
};
```

- `userKey` = jméno profilu; `default` je vestavěný fallback (nelze smazat, vždy
  první v konzoli) zobrazený dokud face-reco nedoběhne nebo při `user_unknown`.
- `position` používá standardní MagicMirror regiony (`top_left`, `top_center`,
  `middle_center`, `bottom_right`, …).

---

## 7. Naše moduly (`MagicMirror/modules/`)

V repozitáři je **7** vlastních / vendored modulů. Každý drží stejnou kostru:
`<Name>.js` (frontend), `<Name>.css`, `node_helper.js` (backend), `package.json`
(`private:true`), `README.md`, `demo.html` (standalone preview) a často
`demo-render.js` (Playwright screenshoty).

| Modul | Co zobrazuje | Zdroj dat / API |
|---|---|---|
| **MMM-Brno-Transit** | Nejbližší odjezdy IDS JMK z dané zastávky vč. zpoždění | GTFS feed z data.brno.cz (týdně) + live vozidla IDSJMK |
| **MMM-HA-Reminders** | Úkoly z iPhone Reminders | Home Assistant REST API, entity `todo.*` |
| **MMM-Mail** | Nepřečtené e-maily, multi-folder, per-folder SLA countdown | IMAP; fork `MMPieps/MMM-Mail` pinned `c24f973` |
| **MMM-Spending** | Dnešní útrata + posledních pár transakcí | Wallet by BudgetBakers REST API |
| **MMM-GoogleCalendar** | Události z Google Calendar (timeline) | Google Calendar API (OAuth2); fork `randomBrainstormer` v1.2.0 |
| **MMM-Package-Tracker** | Sledované balíky (kurýr + stav + ETA) | HA todo `todo.balicky` + AfterShip universal API |
| **MMM-Profile** | *legacy/retired* — nahrazeno jádrem `js/profile.js` | — |

### Detaily klíčových modulů

**MMM-Brno-Transit** — `node_helper` stáhne a rozparsuje GTFS (`stops.txt`,
`routes.txt`, `trips.txt`, `stop_times.txt`, `calendar*`), drží in-memory index
v `cache/`, periodicky tahá live polohy vozidel a páruje je na plánované odjezdy
kvůli zpožděním. Konfig: `stopName`, `gtfsUrl`, `gtfsRefreshHours` (≈168),
`lines`, `perLine`, `refreshSec`.

**MMM-HA-Reminders** — volá HA `todo/get_items` (`return_response`), parsuje
`uid/summary/status/due`, třídí dle termínu. Konfig: `haUrl`, `haToken`,
`todoEntities`, `maxItems`, `showDueDate`, `refreshSec`, `language`.

**MMM-Mail** — IMAP klient s long-live spojením, sleduje nové zprávy a SLA
deadline (badge ok/warn/crit/over). Konfig: `host/port/user/pass`, `mailboxes`
(`[{name, slaHours}]`), `numberOfEmails`, `subjectlength`.

**MMM-Spending** — tahá dnešní `expense` záznamy z Wallet API od lokální půlnoci,
sčítá částky, filtruje převody. Konfig: `apiToken`, `apiBase`, `includeAccountIds`,
`excludeEnvelopeIds`, `timezone` (`Europe/Prague`), `currency`, `recentCount`,
`refreshSec`.

**MMM-Package-Tracker** — čte tracking čísla z HA todo listu, registruje je v
AfterShip (autodetekce kurýra), cachuje stav offline; `Delivered` položky
auto-completuje v HA (zmizí z iPhone i ze zrcadla). Konfig: `haUrl/haToken`,
`todoEntity` (`todo.balicky`), `aftershipApiKey`, `autoCompleteOnDelivered`,
`pruneAfterDays`, `refreshSec`.

---

## 8. Kamera / rozpoznávání obličeje (`camera/`)

| Soubor | Role |
|---|---|
| `face_reco_daemon.py` | event-driven daemon: odběr `presence`, na `present` skenuje kameru a publikuje `recognition` |
| `encode_faces.py` | trénink: projde `dataset/<jmeno>/*.jpg`, vytvoří 128-D enkódy → `encoded_faces.pickle` (umí inkrementální `--name`) |
| `face_reco_once.py` | jednorázové rozpoznání (test/learn režim supervisoru) |
| `gesture_reco_once.py` | detekce gest / počítání prstů (MediaPipe) |
| `capture_photos.py` | snímání fotek pro enrollment do `dataset/<jmeno>/` |
| `face_reco.service` | systemd unit (instalovaná, ale **disabled** — řídí ji supervisor) |
| `setup.sh` | instalace deps (`face_recognition`, `opencv`, `mediapipe`, `picamera2`, mosquitto) + sudoers |

**Workflow tréninku:** `dataset/<jmeno>/*.jpg` → `encode_faces.py` →
`encoded_faces.pickle` (`{"encodings":[…], "names":[…]}`).

**Klíčové konstanty:** HOG model, tolerance **0.6**, skenovací interval ~0.3 s,
max doba skenu ~3 s (produkce) / ~10 s (on-demand), rozlišení 320×240 (daemon).
Broker `127.0.0.1:1883`.

---

## 9. Radar LD2450 (`ld2450/`)

`ld2450_daemon.py` — hlavní daemon přítomnosti.

**Parsování rámce:** engineering-mode rámce, hlavička `AA FF 03 00`, 3 cíle po
8 bajtech, patička `55 CC`. Každý cíl: `X` (uint16 LE, mm), `Y` (cm → ×10 na mm),
rychlost, rezerva.

**Zóna a detekce přítomnosti:**

| Parametr | Hodnota |
|---|---|
| Zóna X | `±400 mm` |
| Zóna Y | `0–1500 mm` |
| Vstupní debounce | 3 po sobě jdoucí rámce v zóně → `present` |
| Výstupní timeout | 60 s bez cíle → `absent` |
| Max dosah (filtr) | 6000 mm |
| Puls relé GPIO17 | 100 ms (jinak INPUT/high-Z) |

**Vyhlazování (`TargetSmoother`, EMA):** `alpha` 0.3, deadband 60 mm, gate 600 mm,
max misses 5 rámců.

**Kalibrace (`radar_config.json`, per-Pi, gitignored):** offset X, invert/mirror
osy, zóna, vyhlazování, vyloučené „ghost" body (naučené z 10 s klidu, kvantizace
na mřížku 150 mm).

**MQTT témata radaru:**

| Téma | Směr | Payload |
|---|---|---|
| `smartmirror/radar/presence` | publikace | `present` / `absent` |
| `smartmirror/radar/targets` | publikace (~10 Hz) | `{targets, present, zone}` |
| `smartmirror/radar/control` | odběr | příkazy `set_config`/`get_config`/`set_center`/`set_axis`/`baseline`/`reset` |
| `smartmirror/radar/config` | publikace (retained) | aktuální konfig (sync UI) |

`ld2450.service` — systemd unit (user `admin`, závisí na `mosquitto`, env
`MQTT_BROKER`/`MQTT_PORT`), enabled. Testy: `test_ld2450.py` (parser + smoother,
bez HW), `radar_visualizer.py`, `viewer.py` (`--simulate`).

---

## 10. Mirror Console (`mirror-console/`)

Webová konzole na `http://<pi>:8000`. Architektura **Express (Node) + React/Vite
+ Python supervisor**, kde **supervisor je jediný arbitr kamery**.

```
Prohlížeč (LAN) ──HTTP :8000──► Express (server/index.js)
                                  ├─ proxy ──HTTP :8001──► supervisor.py (kamera)
                                  ├─ MQTT bridge (SSE monitor + publish)
                                  └─ React build (dist/)
```

### Záložky (taby) UI

| Tab | Funkce |
|---|---|
| **Kamera** | arbitr kamery: režimy *Face detect* / *Test obličejů* / *Test gest* + živý MJPEG stream |
| **Profily** | enroll obličejů (wizard foto → trénink) + per-profil **Rozložení** (layout editor: časová okna + **Výchozí** default) |
| **Radar** | živá SVG mapa cílů + zóna + ON/OFF (systemctl) |
| **MQTT** | testovací publikace (presence/recognition/gesture/reset) + live monitor sběrnice |
| **Moduly (AI)** | stavba nového MagicMirror modulu chatem s Claude (Claude Agent SDK na Pi) |

### `backend/supervisor.py` (`127.0.0.1:8001`)

Režimy: `face_detect` (default — uvolní kameru, spustí `face_reco`), `test_face`
(stream s rámečky + jmény), `test_gesture` (MediaPipe landmarks + počet prstů),
`learn` (enrollment). Režim se persistuje v `mode.state`.

Hlavní endpointy: `GET/POST /mode`, `GET /healthz`, `GET /stream.mjpg`,
`POST /capture`, `GET/DELETE /dataset`, `GET /photo`, `POST /encode`,
`GET /modules`, `GET/PUT /layout`, `POST /layout/apply`, `/store/*`.

**Layout editor** přes `PUT /layout` zvaliduje a vygeneruje `config/pages.js` +
injektuje spravované instance modulů do `config.js` (mezi MIRROR-CONSOLE markery);
`POST /layout/apply` → `pm2 restart MagicMirror`.

### `server/module-ai.js` — AI stavba modulů

Flow: `POST /api/modules/draft` (scaffold 6 souborů do `module-drafts/<name>/`)
→ `GET /api/modules/chat/stream` (SSE výstupu agenta) → `POST /api/modules/chat`
(jeden tah Claude přes lokální `claude` CLI) → live preview `demo.html` v iframe
→ `POST /api/modules/finalize` (instalace do `MagicMirror/modules/` + registrace
v katalogu). Historie v `CLAUDE.md` (lidsky čitelná, putuje s modulem) +
`.module-chat.json`. Model default `claude-opus-4-8` (override `MODULE_AI_MODEL`).

### systemd units

- `mirror-console-backend.service` — `supervisor.py` na `:8001`.
- `mirror-console-web.service` — `index.js` na `:8000`.
- `sudoers.d/mirror-console` — povoluje `admin` passwordless `systemctl
  start/stop/restart face_reco`.

Per-Pi stav (gitignored): `backend/layout_store.json`, `backend/installed_modules.json`,
`backend/custom_modules.json`, `backend/mode.state`, `module-drafts/`.

---

## 11. Fork jádra: změny vs upstream MagicMirror² v2.36.0

Vendored fork (branch `feature/mmm-profile-builtin`). Delta pro pozdější
upstreaming:

**Nové soubory:**

- `js/profile.js` — celý `ProfileManager` (MQTT + stavový automat + resolve layoutu
  + socket emise). Bez upstream ekvivalentu.
- `css/profile.css` — styly Face ID indikátoru (scanning ring → check/X → avatar),
  zrcadlí `tests/face-id-animation.html`.

**Upravené soubory:**

- `js/app.js` — `require("./profile")`, po startu node_helperů
  `new ProfileManager(config, io).start()`; **`POST /module/hot-load`** route
  (runtime `loadModule` + start helperu + `io.emit("MODULE_HOT_LOAD")`).
- `js/loader.js` — data modulu nesou **`id`** (headline feature forku);
  **`hotLoadModule(moduleData)`** pro runtime fetch + register.
- `js/main.js` — **`projectLayout(layout)`** (přesun každého id-modulu do regionu z
  aktivního layoutu, lockString `mm-profile`), socket handlery **`PROFILE_STATE`**
  / **`PROFILE_PREVIEW`** / **`MODULE_HOT_LOAD`**, Face ID indikátor
  (`buildProfileHTML`/`renderProfileIndicator` do `top_center`), přepsaný
  **`createDomObjects`** (DOM jen pro id-moduly v skrytém `#mm-hot-staging`,
  `position` ignorováno), **`MM.addModule(mObj)`** pro runtime hot-load.
- `package.json` — přidané deps: **`cron-parser` ^4.9.0** (cron okna),
  **`mqtt` ^5.11.2** (sběrnice profilů); přítomen i `croner`.

**Animace Face ID** — kanonická reference `tests/face-id-animation.html`. Stav →
třída na `.profile`: `scanning` (bez třídy) / `success` / `error`.

---

## 12. Provozní postupy

### Instalace na čisté Pi

```bash
scp setup.sh admin@10.0.0.249:~
ssh admin@10.0.0.249 'bash ~/setup.sh'      # naklonuje repo a chainuje komponenty
# uvnitř repa:
cd ~/smartMirror && ./setup.sh              # camera + radar + console + MagicMirror
```

`setup.sh` je idempotentní, chainuje `setup.sh` každé komponenty, instaluje
sudoers a klonuje privátní `MMM-store` katalog do `store/`. Zbývající ruční kroky:
povolit UART (`raspi-config`) a `pm2 startup`.

### Deploy (běžná aktualizace)

Push do gitu → na Pi `git pull` (resp. `deploy.sh`: pull + npm install +
rebuild webu + restart `mirror-console-backend/-web`, `ld2450`, `pm2 MagicMirror`
+ health check `/healthz`).

### Reset

- `cleanup-pi.sh` — odstraní naše služby/pm2/sudoers, zachová repo; nejdřív zálohuje
  config + obličeje + per-Pi stav do `~/mirror-backup-<ts>/`.
- `nuke-pi.sh` — vše z cleanup + smaže `~/smartMirror` (záloha je mimo repo).

### Časté příkazy (na Pi přes SSH)

```bash
pm2 restart MagicMirror              # aplikovat změny config/modulů/pages.js
pm2 logs MagicMirror --lines 100
sudo systemctl restart ld2450
journalctl -u ld2450 -f
sudo systemctl restart mirror-console-backend mirror-console-web
curl -s http://127.0.0.1:8000/healthz; echo
cd ld2450 && pytest                  # hardware-free testy parseru/trackeru
```

### Běžící služby

| Služba | Stav | Co dělá |
|---|---|---|
| `ld2450` | enabled | radar daemon |
| `mirror-console-backend` / `-web` | enabled | konzole (supervisor + web) |
| `face_reco` | **disabled** | rozpoznávání — startuje/stopuje ji supervisor |
| MagicMirror | pm2 (proces `MagicMirror`) | jádro zrcadla |

---

## 13. Specy a plány (`docs/superpowers/`)

**Specy (design):**

| Soubor | Téma |
|---|---|
| `2026-04-14-ld2450-presence-detection-design.md` | radar: zóna + GPIO relé |
| `2026-04-14-magicmirror-face-recognition-design.md` | continuous recognition v1 (superseded) |
| `2026-04-26-mmm-profile-design.md` | **aktuální** event-driven profilový systém |
| `2026-04-27-mmm-package-tracker-design.md` | sledování balíků |
| `2026-04-27-spending-design.md` | dnešní útrata z Walletu |
| `2026-04-28-mmm-health-design.md` | zdraví/kroky |
| `2026-04-28-mmm-steps-design.md` | počítadlo kroků |
| `2026-06-05-module-store-design.md` | katalog + instalace modulů (Module Store) |

**Plány (task-by-task checkboxy):** `2026-04-14-ld2450-presence-detection.md`,
`2026-04-14-magicmirror-face-recognition.md`, `2026-04-26-mmm-profile.md`,
`2026-04-27-mmm-package-tracker.md`, `2026-04-27-spending.md`,
`2026-04-28-mmm-steps.md`.

> Pozn.: `MMM-Steps` / `MMM-Health` jsou zatím **jen specy/plány** — modul v
> `MagicMirror/modules/` ještě neexistuje.

---

## 14. Konvence

- Specy → `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`
- Plány → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` s `- [ ]` kroky
- Commity: conventional-commit prefixy (`docs:`, `feat:`, `chore:`, `test:`),
  často scoped (`feat(MMM-Mail): …`)
- Větve pro práci s Claude: `claude/<slug>`
- Vizuální náhledy modulů žijí v `demo.html` vedle zdroje; po pushi se sdílí
  raw.githack URL:
  `https://raw.githack.com/Domes711/smartMirror/<branch>/MagicMirror/modules/<MMM-Foo>/demo.html`

---

## 15. Souhrn MQTT témat (celé sběrnice)

| Téma | Producent | Konzument | Payload |
|---|---|---|---|
| `smartmirror/radar/presence` | ld2450 daemon | profile.js, face_reco | `present` / `absent` |
| `smartmirror/radar/targets` | ld2450 daemon | konzole (Radar tab) | `{targets, present, zone}` (~10 Hz) |
| `smartmirror/radar/control` | konzole | ld2450 daemon | JSON příkazy kalibrace |
| `smartmirror/radar/config` | ld2450 daemon | konzole | aktuální konfig (retained) |
| `smartmirror/camera/recognition` | face_reco | profile.js | `{"user":"…"}` / `{"user":null}` |
| `smartmirror/camera/gesture` | face_reco/gesture | profile.js | gesto |
| `smartmirror/control/reset` | konzole | profile.js, face_reco | reset stavu |
```
