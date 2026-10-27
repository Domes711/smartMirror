# Backend refactor — feasibility analysis & target structure

## Cíl

Root-level `backend/`, `frontend/` (= dnešní `mirrorControl/`), `MagicMirror/`.
FE a MagicMirror se **jen přesunou** (žádný refactor jejich vnitřku). Backend
se rozpadne na **feature-folders** (clean architecture), zruší se REST proxy
vrstva (`mirror-console/server/index.js` proxy routes), zruší se
`supervisor.py` monolit a jeho odpovědnosti se rozdistribuují do feature
složek. Komunikace backend ↔ app bude MQTT, kde to jde. Persistence: jedna
centrální SQLite DB nahradí `layout_store.json` / `installed_modules.json` /
`custom_modules.json` (a případně `radar_config.json`, face-profile metadata).

## Současný stav (inventář)

### `supervisor.py` (1861 LOC, stdlib `http.server`, **0 MQTT**)

| Subsystém | Řádky | Cílová feature |
|---|---|---|
| systemctl helpers (ovládá `face_reco`, `ld2450` units) | 111–160 | `camera/`, `radar/` (shared helper do `shared/`) |
| Module catalog scan | 235–330 | `modules/` |
| Layout/store persistence (JSON load/save) | 352–495 | `scenes/` → SQLite |
| pages.js / console-modules.js codegen | 483–614 | `scenes/` |
| Community module store fetch | 615–840 | `store/` |
| Install/uninstall worker (git clone, npm install) | 847–927 | `store/` |
| **Camera arbitrace + mode machine** (picamera2) | 928–1104 | `camera/` |
| Capture loop + overlaye (cv2, mediapipe, face_recognition) | 1104–1242 | `camera/` |
| Face enrollment / dataset mgmt | 1242–1314 | `camera/` (enrollment podsložka) |
| Encoding / profily | 1314–1414 | `camera/` |
| Health/status | 1414–1440 | `shared/` (health aggregator) |
| Radar start/stop proxy (jen systemctl) | 1442–1452 | `radar/` |
| Layout editor API + hot-load + pm2 restart | 1455–1577 | `scenes/` |
| HTTP routing + MJPEG/photo streaming | 1651–1824 | `camera/` (zůstává HTTP, viz níže) |

### `mirror-console/server/index.js` (191 LOC) + `module-ai.js` (853 LOC)

- **Čistá proxy** (`/mode`, `/capture`, `/dataset`, `/photo`, `/profiles`,
  `/radar`, `/modules`, `/layout`, `/store` ...) → **zrušit celou proxy
  vrstvu**, nahradit MQTT request/reply, kromě binárních/streamových endpointů
  (viz "Co zůstává HTTP").
- **MQTT bridge** (`/api/mqtt/status`, `/publish`, `/subscribe`, SSE
  `/stream`) → zbytečný, pokud FE mluví s brokerem přímo (dnes to z větší
  části už dělá, viz níže) — **zrušit**, jakmile poslední REST-only obrazovky
  (camera/scenes/store) přejdou na MQTT.
- **AI module builder** (`module-ai.js`, 853 LOC, skutečná byznys logika,
  Claude Agent SDK) → vlastní feature `modules-ai/`, zůstává HTTP (SSE chat
  stream se do pub/sub nehodí bez session-topic komplikací — nechat jak je).
- **Store-assets static serving** → zůstává HTTP (statické binární soubory).

### Frontend už je většinově na MQTT

Zjištěno: `mirrorControl` se dnes **přímo připojuje na broker přes WS :9001**
(`services/mqtt.ts`) pro Home/Comms/Monitor/radar/display — to se refactoru
backendu netýká. REST dnes zůstal jen pro: camera/dataset/stream/photo,
profiles, radar (start/stop), scény editor, store (install/catalog), AI
builder. **To je přesně ten povrch, co se zmenší/zmizí.**

Nalezený bug navíc: `thunks.ts:312-320` dnes **duplicitně** publikuje přes
MQTT i REST bridge zároveň ("belt and suspenders") — při refactoru se to
smaže, nahradí čistě MQTT publishem.

### Procesy mimo `mirror-console/` — **již MQTT-only, zůstávají samostatné OS procesy**

`camera/face_reco_daemon.py`, `ld2450/ld2450_daemon.py`,
`display_control/display_control.py` — každý vlastní systemd unit, vlastní HW
přístup (serial, GPIO, I2C/ddcutil). **Nelze je "přesunout" jako Python
import** do jednoho procesu — camera HW je exkluzivní (jen jeden proces může
mít otevřenou `picamera2`), takže feature-folder `camera/` bude obsahovat
**více spustitelných entrypointů** (daemon + supervisor-replacement), ne
jeden modul. To je strukturální omezení, ne věc protokolu.

### Co musí zůstat HTTP (ne MQTT)

- **MJPEG live stream** (`/stream.mjpg`) — binární multipart response.
- **Still photo fetch** (`/photo`) — binární JPEG.
- **AI builder chat SSE** — request-scoped stream, zůstává.
- **Store-assets** — statické soubory.
- Enrollment "capture" je ve skutečnosti jen JSON trigger (ne file upload) —
  **může** jít přes MQTT request/reply, ale je těsně svázaný se stavem
  live-streamu (camera lock, last frame buffer), takže žije ve stejné
  feature `camera/` i tak.

## Proveditelnost: verdikt

| Část plánu | Proveditelnost | Poznámka |
|---|---|---|
| `frontend/`, `MagicMirror/` = prostý přesun | **Snadné** | Změnit cesty v `deploy.sh`/`setup.sh`/systemd units, jinak 1:1 move. |
| Feature-folder rozpad backendu | **Proveditelné, střední náročnost** | Supervisor jde rozpitvat podle tabulky výše čistě. Hlavní práce je mechanická extrakce + nová MQTT routing vrstva. |
| Zrušit REST proxy úplně | **Z části** | Proxy vrstva (čistá passthrough) ano. Binární streamy a AI-builder SSE **musí zůstat HTTP** — realistický cíl je "zrušit proxy, ne zrušit HTTP úplně". |
| Vše na MQTT | **Z části, ~80 %** | Command/config/status endpoints ano. Video/foto/binární a interaktivní chat SSE ne (nejde o volbu technologie, ale o datový tvar). |
| Smazat `supervisor.py` úplně | **Ano, ale ne 1:1 smazání procesu** | Zmizí *ten soubor*; camera-feature potřebuje nový proces, co dělá totéž (arbitrace + MJPEG + enrollment), jen rozdělený do modulů uvnitř `camera/`. |
| Centrální SQLite | **Proveditelné** | Nahradí `layout_store.json` (→ `scenes`), `installed_modules.json`, `custom_modules.json`. Zvážit WAL mode pro souběžný čtení z FE+daemonů. Zálohovatelnost/debug na Pi přes `sqlite3` CLI (dnes `cat *.json` přes SSH) — zmínit v `setup.sh`/README jako novou dep. |

## Navrhovaná struktura repa

Žádná centrální `systemd/` ani `store/` složka v `backend/` — **každá
feature je plně samostatná jednotka**: kód, MQTT wiring, `.service` unit(y)
i vlastní `setup.sh`, přesně podle vzoru, který dnes už používají `camera/`,
`ld2450/`, `display_control/` (unit file žije přímo u kódu, ne centrálně).
`modules` a `modules_ai` (dnešní `module-ai.js`) se **slučují do jedné**
feature `modules/` — je to jeden doménový celek (správa modulů na mirroru),
jen se dvěma vstupy (REST/MQTT store operace + AI builder chat).

```
smartMirror/
├── backend/
│   ├── shared/
│   │   ├── db.py                   # SQLite connection, schema/migrations
│   │   ├── mqtt_client.py          # shared paho-mqtt wrapper (connect/retry/publish/subscribe)
│   │   └── systemctl.py            # systemctl helpers
│   ├── features/
│   │   ├── camera/
│   │   │   ├── daemon.py           # face_reco_daemon (MQTT: presence→recognition)
│   │   │   ├── supervisor.py       # arbitrace + MJPEG/photo HTTP (zůstává HTTP server zde)
│   │   │   ├── enrollment.py       # capture/encode/profiles (dataset mgmt → SQLite)
│   │   │   ├── encode_faces.py
│   │   │   ├── mqtt.py             # MQTT topics owned by this feature
│   │   │   ├── camera-recognition.service
│   │   │   ├── camera-supervisor.service
│   │   │   └── setup.sh
│   │   ├── radar/
│   │   │   ├── daemon.py           # ld2450 daemon (serial + GPIO + MQTT)
│   │   │   ├── mqtt.py
│   │   │   ├── radar.service
│   │   │   └── setup.sh
│   │   ├── display/
│   │   │   ├── daemon.py           # display_control (ddcutil + MQTT)
│   │   │   ├── mqtt.py
│   │   │   ├── display.service
│   │   │   └── setup.sh
│   │   ├── scenes/
│   │   │   ├── store.py            # SQLite-backed scenes CRUD
│   │   │   ├── codegen.py          # pages.js / console-modules.js generation
│   │   │   ├── mqtt.py             # scene apply/reload over MQTT
│   │   │   ├── scenes-api.service
│   │   │   └── setup.sh
│   │   └── modules/                # = dnešní "store" + "modules_ai" sloučené
│   │       ├── catalog.py          # community module catalog fetch/install/uninstall → SQLite
│   │       ├── ai_builder.py       # AI module builder chat/draft/finalize (Gemini + Antigravity SDK, zůstává HTTP/SSE)
│   │       ├── mqtt.py             # store install/uninstall/status přes MQTT
│   │       ├── modules.service
│   │       └── setup.sh
│   └── setup.sh                    # master: chains every feature's setup.sh
├── frontend/                       # = today's mirrorControl/, moved as-is
├── MagicMirror/                    # unchanged, moved as-is (if not already at root)
├── docs/
└── ...
```

**Poznámky k struktuře:**
- `camera/`, `radar/`, `display/` si drží **vlastní spustitelný daemon** —
  to odráží realitu, že jde o oddělené systemd procesy s exkluzivním HW
  přístupem, ne o vrstvu v monolitu.
- `shared/mqtt_client.py` a `shared/db.py` jsou jediné sdílené kusy — každá
  feature si přes ně jen "zapůjčí" broker connection / DB handle, žádná
  feature nezná vnitřek druhé.
- `modules/ai_builder.py` zůstává HTTP-based (SSE chat stream) i po sloučení
  — je to jediné místo v `modules/`, kde HTTP je správná volba, ne dluh.
  `catalog.py` (install/uninstall/status) přechází na MQTT. **Celý backend je
  čistě Python** (rozhodnuto) — žádný Node runtime, jeden jazyk/jeden
  `setup.sh` vzor pro všechny features.
- **AI builder model/SDK: Gemini + Antigravity SDK** (rozhodnuto, nahrazuje
  dnešní Node/Claude Agent SDK `module-ai.js`) — `antigravity-sdk-python`,
  stejný agent harness (file read/write/edit/search/list v sandboxu) jako
  Claude Agent SDK, ale od Googlu a v Pythonu. Úkol (scaffold/edit
  MagicMirror modulu podle known patternu) je dost jednoduchý, že Gemini na
  něj stačí; náročnější práce na repu zůstává u Claude. Riziko: SDK je nové
  (nahradilo Gemini CLI v půlce 2026), dnešní draft/edit/adopt/session
  workflow v `module-ai.js` se musí přepsat proti jiným API tvarům, ne jen
  vyměnit model.
- **Module-store katalog se stěhuje do SQLite jako součást refactoru** —
  ruší se externí privátní repo `MMM-store.git` i jeho clone krok v
  `setup.sh`. Vlastní moduly i celý upstream komunitní katalog
  (~1400 modulů) se naimportují do SQLite jako seed. Backend už za běhu nic
  externě nefetchuje. **Import skript a budoucí aktualizace katalogu jsou
  mimo scope téhle analýzy** — řeší se samostatně. Screenshoty (PNG)
  zůstávají jako **soubory na disku**
  (`backend/features/modules/assets/<name>/*.png`), SQLite řádek jen
  referencuje cestu — binární blob v DB by zbytečně nafukoval DB file a
  komplikoval servování přes HTTP.
- `backend/features/camera/supervisor.py` je zmenšený nástupce dnešního
  supervisoru — drží jen to, co musí být v jednom procesu (HW lock, MJPEG
  stream, mode machine), zbytek (scenes, modules) se z něj odstěhoval.

## SQLite — centrální DB

Jedna DB file (např. `backend/shared/smartmirror.db`), přístupná přes
`shared/db.py` (connection + schema/migrations), nahrazuje:

- `layout_store.json` → `scenes` feature
- `installed_modules.json`, `custom_modules.json` → `modules` feature
- **module katalog** (dnes `store/modules/*/mm-store.json` v externím repu +
  celý upstream `modules.magicmirror.builders` katalog) → `modules` feature,
  jednorázově naimportovaný seed, žádný externí repo/live-fetch
- případně `radar_config.json` (kalibrace) → `radar` feature
- face-profile metadata (dnes vedle `encoded_faces.pickle`) → `camera` feature

Každá feature má v DB vlastní tabulku/namespace (prefix = feature název);
`shared/db.py` řeší jen connection pooling + WAL mode (souběžné čtení z více
procesů/daemonů) a migrace schématu — žádná feature nesahá do tabulky jiné
feature přímo. `encoded_faces.pickle` (binární face encodings pro
`face_recognition` lib) zůstává na disku jako soubor — do SQLite nepatří
(binární blob, čte ho jen jeden proces).

### Tabulky

Odvozené ze skutečných polí dnešních JSON souborů (`supervisor.py:298-311`
`DEFAULT_STORE`, `_pages_object`, `load_installed_modules`/`custom_modules`).

**Profily jsou cross-cutting — žijí ve `shared/`, ne v `camera` nebo
`scenes`.** Dnes profil (`"táta"`, `"default"`, …) nemá vlastní trvalý
záznam — je to odvozená entita z existence adresáře `dataset/<name>/`
(`supervisor.py:1348` `list_profiles`), plus hardcoded `"default"`, co
existuje vždy. Jak `camera` (trénované tváře) tak `scenes` (per-profil
layout) na profil odkazují, proto patří do `shared/` s DB-vynucenou
integritou (nejde vytvořit scénu pro neexistující/smazaný profil):

| Tabulka | Klíčové sloupce | Odpovídá dnešnímu |
|---|---|---|
| `profiles` | `name` (PK, text), `builtin` (bool), `created_at` | odvozeno z `dataset/<name>/` adresářů + hardcoded `"default"` (`DEFAULT_PROFILE`) |

`camera_profiles` (níže) je **1:1 rozšíření** `profiles` o camera-specific
metadata (photo_count), ne duplicitní entita. `scene_windows.profile` a
`scene_default_entries.profile` jsou FK → `profiles.name`.

**`scenes` feature** — nahrazuje `layout_store.json`:

Terminologie: "scéna" = jedna sada umístěných modulů pro daný profil — buď
vázaná na časové okno (`scene_windows`, aktivní jen 6:00-9:00 apod.), nebo
**výchozí scéna** (`scene_default_entries`) — ta, co se zobrazí pro
daný profil, **když právě neplatí žádné časové okno** (to je dnešní
`store["defaults"][profile]` — v UI tlačítko "Výchozí"). Nejde o
systémové/globální výchozí nastavení, jen o poslední záchrannou síť layoutu
per profil.

| Tabulka | Klíčové sloupce | Odpovídá dnešnímu |
|---|---|---|
| `scene_instances` | `id` (PK, text), `type`, `values` (JSON text) | `store["instances"]` — placed module instances (type + field values) |
| `scene_windows` | `id` (PK), `profile` (FK → `profiles.name`), `window_name`, `from_cron`, `to_cron`, `label` | `store["windows"][profile][windowName]` — časově ohraničená scéna |
| `scene_window_entries` | `id` (PK), `window_id` (FK → `scene_windows.id`), `instance_id` (FK → `scene_instances.id`), `position` | `window.layout[]` — `{id, position}` placement rows uvnitř okna |
| `scene_default_entries` | `id` (PK), `profile` (FK → `profiles.name`), `instance_id` (FK → `scene_instances.id`), `position` | `store["defaults"][profile]` — výchozí scéna pro profil, použitá když žádné okno zrovna neplatí |

**`modules` feature** — nahrazuje `installed_modules.json`, `custom_modules.json`, a celý community katalog (dnešní `store/modules/*/mm-store.json` + upstream `modules.magicmirror.builders`):

| Tabulka | Klíčové sloupce | Odpovídá dnešnímu |
|---|---|---|
| `module_catalog` | `type` (PK), `module_name`, `label_cs`, `label_en`, `description_cs`, `description_en`, `scope`, `source` (`builtin`/`installed`/`custom`/`community`), `repo_url`, `installed_at` | sloučení `MODULE_CATALOG` (built-in) + `installed_modules.json` + `custom_modules.json` + naimportovaný upstream katalog |
| `module_fields` | `id` (PK), `module_type` (FK → `module_catalog.type`), `key`, `label_cs`, `label_en`, `required`, `field_type`, `placeholder` | `MODULE_CATALOG[*].fields[]` / katalogová `wizard` pole |
| `module_screenshots` | `id` (PK), `module_type` (FK), `asset_path`, `caption` | `mm-store.json["screenshots"]` — cesta na disk (`assets/<name>/*.png`), ne BLOB |
| `module_tags` | `module_type` (FK), `tag` | `mm-store.json["tags"]` |
| `module_install_jobs` | `id` (PK), `module_type`, `status`, `started_at`, `finished_at`, `error` | dnešní polling stav `_install_worker` (`GET /store/install/status`) |

**`radar` feature** — nahrazuje `radar_config.json`:

| Tabulka | Klíčové sloupce |
|---|---|
| `radar_config` | `key` (PK, text), `value` (JSON text) — jednoduchá key-value (offset, mirror, zone, smoothing, ghost exclusions) místo plného JSON objektu |

**`camera` feature** — nahrazuje dnešní per-person složky + nepřímou metadatu v `dataset/`:

| Tabulka | Klíčové sloupce |
|---|---|
| `camera_photos` | `id` (PK), `profile_name` (FK → `profiles.name`), `file_path`, `captured_at` | jednotlivé fotky v `dataset/<name>/*.jpg` — řádek jen referencuje soubor |

Žádná `camera_profiles` tabulka — po přesunu `name`/`builtin` do sdílené
`profiles` by zbyl jen `photo_count`, a ten je čistě odvozená hodnota
(`COUNT(*)` nad `camera_photos` pro daný profil), přesně jak to dnes počítá
`list_profiles()` za běhu (`len(photos)`), ne uložená data. Zbytečná 1:1
tabulka s jediným derivovaným sloupcem.

`encoded_faces.pickle` zůstává souborem (binární face-encoding blob pro
`face_recognition` lib, generovaný z `camera_photos`, nepatří do SQL řádku).

**Shared / cross-feature:**

| Tabulka | Klíčové sloupce | Poznámka |
|---|---|---|
| `schema_migrations` | `version` (PK), `applied_at` | `shared/db.py` — verze schématu, ne feature-specific |

## Rozhodnutí

1. **Jazyk: čistě Python** napříč všemi features, včetně `modules/ai_builder.py`
   (přepsat z dnešního Node/`module-ai.js` na Python ekvivalent Claude Agent
   SDK) — jeden runtime, jeden `setup.sh` vzor.
2. **Pořadí migrace:** `radar` → `display` → `scenes` → `modules` → `camera`.
   Radar/display nejdřív (už MQTT-only, bezrizikové přesunutí souborů +
   zavedení SQLite pro `radar_config.json`), scenes/modules střední
   náročnost (JSON/katalog → SQLite + REST→MQTT), camera naposled
   (nejriskantnější — HW arbitrace, streaming, supervisor rozpad).
3. **Module-katalog import/update skript je mimo scope** této analýzy —
   řeší se samostatně, až přijde na řadu feature `modules`.
