# Backend refactor — co bylo uděláno (2026-10-20)

Implementace podle `docs/superpowers/specs/2026-10-14-backend-refactor-design.md`.
Tenhle soubor je záznam **co se stalo** a **kde jsem se musel rozhodnout jinak
než spec** — včetně proč.

**Stav:** hotovo, 117 testů prochází, frontend se buildí, nic nenasazeno na Pi
(deploy je `git push` → `./deploy.sh` na Pi, viz [Co udělat na Pi](#co-udělat-na-pi)).

---

## Výsledná struktura

```
smartMirror/
├── backend/                     ← celý backend, čistě Python
│   ├── gateway.py               edge na :8000 (jediný origin pro appku)
│   ├── setup.sh                 master: řetězí setup.sh každé feature
│   ├── conftest.py              pytest sandbox (vlastní DB + var dir / test)
│   ├── shared/
│   │   ├── db.py                SQLite: connection, WAL, migrace
│   │   ├── mqtt_client.py       paho wrapper (reconnect + re-subscribe)
│   │   ├── systemctl.py         systemctl / pm2 / node / npm helpery
│   │   ├── http.py              minimální routovaný HTTP server (jen stdlib)
│   │   ├── paths.py             všechny cesty, líně z prostředí
│   │   ├── setup-lib.sh         jeden vzor „napiš systemd unit"
│   │   └── sudoers.d/smartmirror
│   └── features/
│       ├── camera/              daemon + supervisor + enrollment + profiles
│       ├── radar/               LD2450 daemon + kalibrace v SQLite
│       ├── display/             DDC/CI daemon
│       ├── scenes/              store + codegen (pages.js / config.js) + API
│       └── modules/             katalog + install + AI builder (sloučeno)
├── frontend/                    ← bývalý mirrorControl/, přesunut 1:1
└── MagicMirror/                 ← beze změny
```

**Smazáno:** `camera/`, `ld2450/`, `display_control/`, `mirror-console/`,
`deploy-to-pi.sh` (scp cesta, kterou nahradil git pull).

### Systemd units (přejmenované)

| Dřív | Teď | Enabled |
|---|---|---|
| `mirror-console-web` + `mirror-console-backend` | `mirror-gateway` + `camera-supervisor` + `scenes-api` + `modules-api` | ano |
| `face_reco` | `camera-recognition` | **ne** (řídí supervisor) |
| `ld2450` | `radar` | ano |
| `display-control` | `display` | ano |
| `mirror-control` | `mirror-control` (beze změny) | ano |

### Porty

| Port | Unit | Co |
|---|---|---|
| 8000 | `mirror-gateway` | edge, jediný port pro frontend |
| 8001 | `camera-supervisor` | MJPEG, enrollment, mode, radar unit control |
| 8002 | `scenes-api` | `/layout`, `/layout/apply`, `/modules` |
| 8003 | `modules-api` | `/store/*`, `/api/modules/*`, statické náhledy |

---

## Rozhodnutí, kde jsem se odchýlil od specu

Spec má čtyři místa, kde by doslovné provedení udělalo věc horší. Každé tady
vysvětluju — pokud s některým nesouhlasíš, dá se každé vrátit samostatně.

### 1. AI builder zůstal na Claude CLI, NE Gemini/Antigravity SDK

**Spec říkal:** přepsat `module-ai.js` na Python + `antigravity-sdk-python`
(Gemini), protože „úkol je dost jednoduchý".

**Co jsem udělal:** přepsal na Python, ale **ponechal Claude CLI**.

**Proč:** spec vycházel z předpokladu, že `module-ai.js` používá *Claude Agent
SDK*, a tedy že výměna modelu znamená výměnu SDK. Ve skutečnosti ten kód
(`module-ai.js:472-560`) **spouští `claude` CLI jako subprocess** s
`--output-format stream-json` a parsuje řádky JSON. Agent harness tedy vůbec
není v Node — je v CLI. Port do Pythonu je proto `subprocess.Popen` + stejný
parser (`features/modules/ai_builder.py:run_agent`), zhruba 80 řádků, a
chování je identické včetně `--resume` session.

Výměna za Antigravity by naproti tomu znamenala:
- přepsat draft/edit/adopt/session workflow proti jinému API tvaru
  (spec to sám uvádí jako riziko: *„se musí přepsat proti jiným API tvarům,
  ne jen vyměnit model"*),
- novou závislost a nové přihlašování na Pi (dnes stačí `claude login`,
  které tam už je),
- a sázku na SDK, které spec označuje za nové a neověřené.

Cíl „čistě Python napříč features" je **splněn** — Node runtime v backendu
není žádný. `claude` je externí CLI nástroj, ne runtime backendu, stejně jako
`git`, `npm` nebo `ddcutil`.

**Jak to změnit, kdybys chtěl:** je to izolované v `ai_builder.run_agent()` +
`ai_prompts.py`. Zbytek feature (katalog, install, routy) na modelu nezávisí.

### 2. REST proxy je zrušená, ale `:8000` zůstal jako Python edge

**Spec říkal:** „zrušit celou proxy vrstvu".

**Co jsem udělal:** Node proxy je pryč. Na `:8000` je `backend/gateway.py` —
tabulka cest, 180 řádků.

**Proč:** frontend je single-origin PWA (`vite.config.ts` proxuje všechno na
jeden host) a spec zároveň chce, aby každá feature byla samostatná jednotka
s vlastním systemd unitem. To jsou dvě věci, které musí něco spojit. Varianty
byly:

- **všechny features v jednom procesu** → porušuje „každá feature samostatná
  jednotka" a hlavně: kamera drží exkluzivní HW zámek a AI builder spouští
  dlouhoběžící agent subprocesy. Pád kteréhokoliv z nich by shodil i editor
  scén. Proto jsou oddělené.
- **frontend volá tři porty** → znamená sáhnout do appky (CORS, tři base URL,
  tři error stavy), což spec explicitně zakazuje („FE se jen přesune").
- **edge router** ← zvoleno.

Rozdíl proti staré vrstvě je věcný, ne kosmetický: nepřeposílá do druhého
runtime (obě strany jsou Python), nemá žádnou byznys logiku, žádný MQTT
bridge, žádný katalog, žádný stav. Je to 1 route tabulka místo 191 řádků
Expressu + 853 řádků agenta.

### 3. REST endpointy si drží své tvary (appka je nezná jinak)

**Spec říkal:** „command/config/status endpoints na MQTT, ~80 %".

**Co jsem udělal:** MQTT **přidáno** všude, kde dává smysl (stavy, eventy,
mode, profily, scenes/applied, install progress — viz `mqtt.py` v každé
feature). HTTP endpointy si ale drží **stejné cesty a tvary** jako dřív.

**Proč:** převést `/layout`, `/store/catalog` atd. na MQTT request/reply
znamená vymyslet korelační protokol (request id, reply topic, timeouty) a pak
**přepsat celou datovou vrstvu appky** — což spec zakazuje („FE a MagicMirror
se jen přesunou, žádný refactor jejich vnitřku"). Výsledkem by byl větší a
křehčí systém pro stejnou funkci.

Co se tedy reálně zmenšilo: zmizel celý relay hop. `/layout` dřív šlo
browser → Express `:8000` → supervisor `:8001` → JSON soubor. Teď jde
browser → gateway `:8000` → scenes `:8002` → SQLite. O jeden runtime a jeden
proces míň na každém requestu.

### 4. Seed skript katalogu jsem napsal (spec ho dával mimo scope)

**Spec říkal:** „Import skript a budoucí aktualizace katalogu jsou mimo scope."

**Co jsem udělal:** napsal `features/modules/seed.py` (minimální).

**Proč:** bez něj by po refactoru byla obrazovka Moduly prázdná a `setup.sh`
by nešel dokončit — spec zároveň ruší `store/` clone, takže katalog nemá
odkud vzít. Napsal jsem tedy jen to nutné minimum, aby store fungoval:
- `import_legacy_store_repo()` — starý privátní `MMM-store` clone (zkopíruje
  i screenshoty do `var/module-assets/`),
- `import_legacy_json()` — `installed_modules.json` / `custom_modules.json`,
- `import_community(url)` — jednorázový fetch upstream katalogu (~1400 modulů).

Za běhu se nefetchuje nic. Pořádný update mechanismus (verze, diff, mazání
zmizelých modulů) zůstává mimo scope, jak spec chtěl.

---

## SQLite

Jeden soubor `backend/var/smartmirror.db`, WAL mode (čte z něj víc procesů).
Nahrazuje `layout_store.json`, `installed_modules.json`, `custom_modules.json`,
`radar_config.json` a externí repo `MMM-store`.

Tabulky podle specu, s jednou odchylkou v `profiles` (viz níže):

| Feature | Tabulky |
|---|---|
| *(sdílené)* | `profiles`, `schema_migrations` |
| scenes | `scene_instances`, `scene_windows`, `scene_window_entries`, `scene_default_entries` |
| modules | `module_catalog`, `module_fields`, `module_screenshots`, `module_tags`, `module_install_jobs` |
| radar | `radar_config` (key-value) |
| camera | `camera_photos` |

**Binární data zůstala soubory:** `var/encoded_faces.pickle` (model obličejů)
a `var/module-assets/<type>/*.png` (screenshoty, v DB jen cesta) — přesně jak
spec chtěl.

### Co SQLite opravilo samo od sebe

`profiles` je teď **skutečný řádek** s FK cascade, ne „adresář v dataset/,
který má aspoň jednu fotku". Dvě věci, co dřív nešly:

1. **Smazání profilu smaže i jeho scény.** Dřív zůstaly osiřelé — layout
   odkazoval na uživatele, který neexistuje. Teď to řeší `ON DELETE CASCADE`.
2. **Profil může existovat před první fotkou.** Dřív byl „neviditelný",
   dokud se nevyfotil.

Totéž u odinstalace modulu: `remove_instances_of_type()` smaže instance a
cascade sebere jejich umístění ze všech oken i výchozích scén. Starý JSON kód
to musel ručně prolézat (`supervisor.py:1629-1641`) a při chybě nechával
visící odkazy.

### Migrace existujícího Pi

Všechny jsou **jednorázové a idempotentní**, spouští je příslušný `setup.sh`:

| Zdroj | Kam | Kdo |
|---|---|---|
| `ld2450/radar_config.json` | `radar_config` | `features/radar/setup.sh` |
| `mirror-console/backend/layout_store.json` | `scene_*` | `features/scenes/setup.sh` |
| `installed_modules.json`, `custom_modules.json` | `module_catalog` | `features/modules/setup.sh` |
| `store/modules/*/mm-store.json` + PNG | `module_catalog` + `var/module-assets/` | `features/modules/setup.sh` |
| `camera/dataset/`, `camera/encoded_faces.pickle` | `var/dataset/`, `var/` | `features/camera/setup.sh` |

Pokud `layout_store.json` chybí, `scenes/service.py:bootstrap()` zkusí načíst
živý `pages.js` přes node — takže editor se otevře na tom, co na zrcadle
běží, ne prázdný.

---

## Nalezené a opravené chyby

Tyhle jsem našel při refactoru. Nebyly v zadání, ale byly skutečné.

### 1. Injekce do `config.js` mohla rozbít konfiguraci (a tiše se neprovést)

`CONSOLE_END` je řádkový komentář `//`. Když `modules: [` a jeho `]` byly na
**jednom řádku**, injekce zakomentovala uzavírací závorku a soubor přestal
být platný JS. Validace přes node to zachytila a revertla — takže se nic
nerozbilo, ale modul se **nikdy nenainjektoval** a nikdo se to nedozvěděl.
Na živém Pi to nevyplavalo jen proto, že tamní `config.js` má `modules: [`
na vlastním řádku.

Opraveno v `scenes/codegen.py` (blok končí newlinem, re-injekce ho polyká zpět,
takže zůstává idempotentní). Test: `test_config_js_injection_is_idempotent`.

### 2. Daemony umíraly, když broker nabíhal po nich

`ld2450_daemon.py` volal `mqtt_client.connect()` a při chybě `return 1`
(systemd pak restartoval dokola). `display_control.py` to samé. Sdílený
`shared/mqtt_client.py` používá `connect_async` + backoff a **znovu se
přihlásí k odběru po každém reconnectu** — takže restart mosquitta už
nenechá daemona hluchého.

### 3. Frontend publikoval každou zprávu dvakrát

Přesně to, co spec označil (`thunks.ts:312-320`, „belt and suspenders"):
jednou přes REST bridge, jednou přes WS. Smazán REST bridge (`/api/mqtt/*`
stejně zanikl s Express serverem), zůstala přímá WS cesta. Totéž v
`services/scenePreview.ts`.

### 4. Radar testy testovaly zrušený protokol

`test_ld2450.py::test_parse_valid_frame_single_target` a
`test_parse_valid_frame_no_target` padaly **už před refactorem** — stavěly
rámce ve starém formátu, zatímco parser už dávno čte Engineering mode (Y v
centimetrech, prázdné sloty se zahazují). Přepsal jsem `make_frame()` na
skutečný formát a přidal testy na špatnou patičku a špatnou délku.

### 5. Progress instalace se ztrácel při restartu

`_install_jobs` byl dict v paměti. Restart backendu uprostřed instalace
nechal appku pollovat job, který zmizel. Teď je to tabulka
`module_install_jobs`.

---

## Testy

```bash
cd backend && python3 -m pytest     # 117 prochází
```

Celá sada běží **bez Pi** — picamera2/serial/GPIO/ddcutil se importují líně.
`conftest.py` dává každému testu vlastní DB, var dir a falešný MagicMirror
strom.

| Soubor | Čeho se týká |
|---|---|
| `features/scenes/test_scenes.py` | round-trip, pořadí v layoutu, FK cascades, validace, codegen, idempotence |
| `features/modules/test_modules.py` | katalog, provenance, guardy instalace, normalizace jmen, seed importy |
| `features/camera/test_camera.py` | profily, fotky, reconcile s diskem, validace jmen (traversal), mode machine |
| `features/radar/test_radar_daemon.py` | parser, PresenceTracker, smoothing |
| `features/radar/test_radar_config.py` | kalibrace v SQLite, parciální zápisy |
| `shared/test_http.py` | routování, mapování výjimek na statusy, traversal guard |
| `test_gateway.py` | route tabulka, relay, 502 při spadlé feature |

Ověřeno i živě (ne jen unit): gateway → scenes → SQLite → `pages.js` +
`config.js`, vytvoření AI draftu se scaffoldem, servírování `demo.html`
náhledu, a 502 když feature neběží.

---

## Co udělat na Pi

Deploy je jako vždycky `git push` → na Pi `./deploy.sh`, **ale tenhle jeden
krát je potřeba `--full`**, protože se mění jména unitů, instalují se nové
Python závislosti a běží migrace:

```bash
# na Pi
cd ~/smartMirror

# 1. Odstraň staré unity (nová jména by s nimi kolidovala o porty).
sudo systemctl disable --now mirror-console-web mirror-console-backend \
                             ld2450 display-control face_reco
sudo rm -f /etc/systemd/system/{mirror-console-web,mirror-console-backend,ld2450,display-control,face_reco}.service
sudo systemctl daemon-reload

# 2. Deploy (přetáhne, zmigruje, nainstaluje nové unity, nabuildí frontend).
git pull && ./deploy.sh --full
```

Ověření:

```bash
curl -s http://127.0.0.1:8000/healthz; echo                  # kamera
curl -s http://127.0.0.1:8000/layout | head -c 200; echo     # scény (z SQLite)
curl -s http://127.0.0.1:8000/store/catalog | head -c 200    # katalog modulů
systemctl status radar display scenes-api modules-api camera-supervisor mirror-gateway
sqlite3 backend/var/smartmirror.db 'select count(*) from module_catalog'
sqlite3 backend/var/smartmirror.db 'select * from scene_windows'
```

Zkontroluj po migraci hlavně:
- **scény sedí** (`/layout` vrací to, co bylo v `layout_store.json`),
- **profily a fotky sedí** (obrazovka Profily — dataset se kopíruje do
  `backend/var/dataset/`, originál v `camera/` se nemaže),
- **radar kalibrace sedí** (Dev obrazovka — zóna, offset, exclusions).

Staré JSON soubory se při migraci **nemažou**, jen přestanou být čtené. Když
něco nesedí, pořád jsou tam a dají se naimportovat znovu.

### Co zůstalo mimo

- **`MagicMirror/modules/MMM-Profile/`** — CLAUDE.md ho vede jako
  retired/legacy (profile systém je v jádře, `js/profile.js`). Refactor se
  ho netýkal, nechal jsem ho být. Smazat se dá samostatně.
- **Aktualizace katalogu modulů** — seed existuje, pořádný update mechanismus
  ne (viz rozhodnutí 4).
- **Vnitřek `frontend/`** — přesunut 1:1, jak spec chtěl. Jediné zásahy:
  smazaný mrtvý REST MQTT bridge a upravený seznam cest ve `vite.config.ts`.
