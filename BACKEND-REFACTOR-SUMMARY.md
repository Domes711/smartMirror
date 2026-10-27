# Backend refactor — shrnutí (2026-10-20)

Rychlý přehled pro další kontext. Plný report s detaily:
`docs/superpowers/plans/2026-10-20-backend-refactor-report.md`.

## Stav

**Hotovo a staged, NEzacommitováno.** Branch `refactor-be`.
117 testů prochází, frontend buildí a typechecká, shell skripty syntakticky
OK. Ověřeno i živě end-to-end (gateway → scenes → SQLite → `pages.js` /
`config.js`, AI draft scaffold, servírování náhledu, 502 při spadlé feature).

## Co se udělalo

Implementace `docs/superpowers/specs/2026-10-14-backend-refactor-design.md`.

**Struktura:** `camera/` + `ld2450/` + `display_control/` + `mirror-console/`
→ jeden `backend/` s pěti feature složkami (každá: kód, `mqtt.py`, systemd
unit, vlastní `setup.sh`). `mirrorControl/` → `frontend/` (přesun 1:1).
`MagicMirror/` beze změny. Smazán i `deploy-to-pi.sh`.

```
backend/
├── gateway.py          edge :8000 (route tabulka, 180 ř.)
├── setup.sh            master, řetězí features
├── conftest.py         pytest sandbox fixture
├── shared/             db.py, mqtt_client.py, systemctl.py, http.py,
│                       paths.py (líné z env), setup-lib.sh, sudoers.d/
└── features/{camera,radar,display,scenes,modules}/
```

**Node z backendu zmizel.** `server/index.js` (191 ř.) + `module-ai.js`
(853 ř.) pryč. `supervisor.py` (1861 ř.) rozpadnut: katalog/store →
`features/modules/`, layout/codegen → `features/scenes/`, kamera (HW zámek,
MJPEG, enrollment) zůstala v `features/camera/supervisor.py`.

**SQLite** `backend/var/smartmirror.db` (WAL) nahrazuje `layout_store.json`,
`installed_modules.json`, `custom_modules.json`, `radar_config.json` a externí
repo `MMM-store`. `profiles` je sdílená tabulka s FK cascade. Binární data
(pickle obličejů, screenshoty) zůstala soubory.

**Unity:** `ld2450`→`radar`, `display-control`→`display`,
`face_reco`→`camera-recognition` (disabled), `mirror-console-*` →
`mirror-gateway` + `camera-supervisor` + `scenes-api` + `modules-api`.
Porty: 8000 gateway, 8001 camera, 8002 scenes, 8003 modules.

## Čtyři odchylky od specu

1. **AI builder zůstal na Claude CLI**, ne Gemini/Antigravity — spec
   předpokládal Claude Agent SDK, ale `module-ai.js` ve skutečnosti spouští
   `claude` CLI jako subprocess s `--output-format stream-json`. Port =
   `subprocess.Popen` + stejný parser. Cíl „čistě Python" splněn.
2. **Proxy zrušena, `:8000` zůstal jako Python edge** — appka je
   single-origin PWA, features jsou oddělené unity, něco to musí spojit.
3. **REST endpointy si drží tvary** — převod na MQTT request/reply by
   znamenal přepsat datovou vrstvu appky, což spec zakazuje.
4. **Napsán seed skript katalogu** (spec ho dával mimo scope) — bez něj by
   byl store prázdný a `setup.sh` by nešel dokončit.

## Pět opravených chyb

Nejzávažnější: **injekce do `config.js` rozbíjela jednořádkový
`modules: []`** (`CONSOLE_END` je `//` komentář, zakomentoval uzavírací
závorku) — node validace to revertla, takže se modul **tiše nikdy
nenainjektoval**. Dále: daemony umíraly, když broker nabíhal po nich;
frontend publikoval každou MQTT zprávu dvakrát; progress instalace se ztrácel
při restartu; radar testy testovaly zrušený protokol (padaly už před
refactorem).

## Dokumentace

| Soubor | Co |
|---|---|
| `docs/superpowers/plans/2026-10-20-backend-refactor-report.md` | plný report |
| `REFACTOR.md` | stručná verze v logu refactorů |
| `backend/README.md` | porty, units, DB, testy |
| `CLAUDE.md` | aktualizována (layout, porty, příkazy, architektura) |

## Zbývá

1. **Commit** (staged: 60 A, 18 D, 10 M, 98 R).
2. **Nasazení na Pi vyžaduje `--full` a ruční smazání starých unitů předem**
   (jména se změnila, kolidovaly by o porty) — přesný postup v reportu.
3. Po migraci zkontrolovat: scény, profily/fotky, radar kalibraci.
   Staré JSON soubory se nemažou.

**Mimo scope:** `MMM-Profile/` (retired, refactoru se netýkal), update
mechanismus katalogu, vnitřek `frontend/` (jen smazán mrtvý REST MQTT bridge
+ upraveny cesty ve `vite.config.ts`).
