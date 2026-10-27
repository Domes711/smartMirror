# Refactor: features/display/ — šablona pro refactor features

Tento dokument popisuje refactor feature `display/` (Dell U2515H over DDC/CI).
Je to **první** feature v sérii — struktura, názvy souborů, tok dat a řešení
systemd unit souboru zde zavedené slouží jako **šablona** pro refactor
ostatních features (`radar/`, `camera/`, `scenes/`, `modules/`), dokud se u
každé z nich nerozhodne jinak.

## Stav před refactorem

`daemon.py` (324 řádků) obsahoval všechno v jednom souboru: konstanty (VCP
kódy, barevné předvolby, power módy), logging setup, celou třídu
`DisplayController` (ddcutil subprocess volání, MQTT subscribe/publish,
business logika), i `main()` entrypoint.

## Nová struktura

| Soubor | Odpovědnost |
|---|---|
| **`daemon.py`** | tenký entrypoint — logging setup, sys.path hack, `main()`: postaví MQTT handler, `client.start()`, smyčka `run()`, shutdown. Žádná business logika, žádná komunikace s displejem přímo. |
| **`mqtt.py`** | napojení na broker a obhospodařování komunikace — `DisplayMqtt` třída: `on_message()` dispatch podle topic suffixu, `publish_state()`. Volá `service.py`, nic neví o ddcutil. |
| **`service.py`** | business logika na vyžádání — `set_brightness()`, `set_contrast()`, `apply_profile()`, `get_monitor_state()`. Volá `driver.py` + `data.device_config`. Nic neví o MQTT. |
| **`driver.py`** | jen funkce mluvící s hardwarem — `ddcutil_setvcp()`, `ddcutil_getvcp()`, `init_monitor()`. Jediné místo, co spouští `ddcutil` subprocess. Konstanty importuje z `constants.py`. |
| **`constants.py`** | všechny konstanty feature na jednom místě — VCP kódy, barevné předvolby, power módy (dřív v `driver.py`) + MQTT topicy (dřív v `mqtt.py`). Žádná logika. |

Pravidlo závislostí (jednosměrné, žádný směr nazpátek):

```
daemon.py → mqtt.py → service.py → driver.py
                           │            │
                           │            └──▶ constants.py
                           └──▶ data/device_config.py

mqtt.py také čte z constants.py (topicy)
```

### Proč `constants.py` navíc

Konstanty (VCP kódy, topicy) byly rozeseté po `driver.py` a `mqtt.py` — kdo
chtěl zjistit "jaké hodnoty/topicy tahle feature má", musel číst oba soubory.
**Rozhodnuto:** jeden `constants.py` pro celou feature, `driver.py`/`mqtt.py`
z něj importují jmenovitě (ne `import *`), takže `driver.VCP_BRIGHTNESS`
apod. dál funguje pro volající beze změny — jen definice žije jinde.

### Proč `daemon.py`, ne `init.py`

Zvažovali jsme `init.py`, ale `init.py` v Pythonu konvenčně znamená buď
`__init__.py` (package init) nebo jednorázovou inicializaci — ne dlouho běžící
proces se smyčkou. `daemon.py` je přesně to, co proces je, a je konzistentní
s `radar/daemon.py`. **Rozhodnuto: zůstává `daemon.py`.**

### Proč ne `controller.py`

`controller.py` zní jako orchestrace, ale skrývá, že jde o *service vrstvu
na vyžádání* (přijde požadavek → zavolá driver → vrátí data), ne o něco, co
samo běží/kontroluje smyčku. **Rozhodnuto: `service.py`.**

## Tok dat

### Tok 1 — manuální změna uživatelem (brightness, contrast, …)

```
MQTT broker
   │ topic: smartmirror/display/control/brightness, payload "50"
   ▼
mqtt.py        on_message() → dispatch podle topicu
   ▼
service.py     set_brightness(profile, 50)
   ├─▶ driver.ddcutil_setvcp(VCP_BRIGHTNESS, "50")   → True/False
   └─ pokud True:
         └─▶ data.device_config.set("monitor", profile, "brightness", 50)
   ▼
mqtt.py        publish_state(force=True)
   └─▶ service.get_monitor_state() → driver.ddcutil_getvcp(...) pro každou hodnotu
   └─▶ client.publish("smartmirror/display/state", state, retain=True)
```

**Pravidlo:** zápis do DB **až po úspěšném nastavení HW**, nikdy předem — DB
by jinak mohla tvrdit stav, který monitor ve skutečnosti nemá (ddcutil
timeout, monitor ve standby, …). Při neúspěchu (`False`) se DB nedotkne, jen
log; `state` se publikuje nezměněný.

### Tok 2 — změna profilu (`smartmirror/control/profile_changed`)

Globální topic napříč features — `display` je jen jeden z odběratelů.

```
MQTT broker
   │ topic: smartmirror/control/profile_changed, payload "dominik"
   ▼
mqtt.py        on_message() → dispatch
   ▼
service.py     apply_profile("dominik")
   ├─▶ data.device_config.resolve("monitor", "dominik")
   │        └─ uvnitř: nejdřív defaults (profile='default'), pak přepsat
   │           jednotlivé klíče z řádků profilu "dominik"
   │        → {brightness: 80, contrast: ..., ...}
   └─▶ pro HW-aplikovatelné klíče (brightness, contrast, ...):
            driver.ddcutil_setvcp(...)
   ▼
mqtt.py        publish_state(force=True)
   └─▶ service.get_monitor_state() → driver.ddcutil_getvcp(...)
   └─▶ client.publish("smartmirror/display/state", state, retain=True)
```

Oba toky končí stejně — publikací plného `state`. Tok 2 se liší zdrojem
hodnot (DB `resolve()` místo MQTT payloadu) a tím, že se do DB nezapisuje
(profil se jen *aplikuje*, nenastavuje nově).

**Vyřazeno z tohoto toku (řešit později, samostatně):** publikace
`smartmirror/display/config` pro core (`dim_timeout_s` apod.) — core nemá
DB driver, takže potřebuje timeouty jinou cestou. Mimo scope tohoto
refactoru.

## systemd unit: `.service` jako šablona, ne generovaný text

### Stav před

`display/setup.sh` volal sdílenou `install_unit()` z `shared/setup-lib.sh`,
která **generuje** celý unit text heredokem s dosazenými hodnotami
(`${RUN_USER}`, `${RUN_GROUP}`, `${BACKEND_DIR}`, `${PY}`). `display.service`
v repu byl jen statická "reference copy" s natvrdo `admin`/`/home/admin/...`
— nikdy se reálně nekopíroval, sloužil jen jako dokumentace shape.

### Stav po (jen pro `display`, ostatní features a `setup-lib.sh` beze změny)

`display.service` se stává **šablonou** s placeholdery:

```
__USER__, __GROUP__, __BACKEND_DIR__, __PYTHON__
```

`display/setup.sh` **nevolá** `install_unit()`. Místo toho:

1. spočítá `RUN_USER`, `RUN_GROUP`, `BACKEND_DIR`, `PY` (stejné hodnoty jako
   dnes `setup-lib.sh`)
2. vezme `display.service`, `sed`em dosadí placeholdery → výstup do
   `/etc/systemd/system/display.service`
3. `systemctl daemon-reload`

`enable_unit display` zůstává (obecná funkce, beze změny potřebná).

Tím je `.service` soubor v repu **skutečný předpis** nasazovaný 1:1, ne jen
odhad shape — a je to vzor, který se při refactoru další feature buď převezme
stejně, nebo se u ní explicitně rozhodne jinak.

## `pip_install paho-mqtt`: přesun na top-level

`paho-mqtt` instalovaly duplicitně `display/setup.sh`, `radar/setup.sh`,
`scenes/setup.sh`, `modules/setup.sh` (`camera` ho má navíc v
`requirements.txt`) — každá feature nezávisle, ačkoliv jde o společnou
závislost (`shared/mqtt_client.py` ji používá všude).

**Rozhodnuto:** `pip_install paho-mqtt` se z `display/setup.sh` odstraňuje a
přesouvá do top-level `backend/setup.sh`, na stejnou úroveň jako
`install_sudoers` / `init_db` (volané jednou, před chainováním feature
setupů). Ostatní features se při tomto refactoru nemění — jejich duplicitní
řádek se odstraní, až se bude refactorovat jejich feature.

## Shrnutí rozhodnutí (pro další features)

Při refactoru každé další feature se stejným vzorem ptát:

1. **`daemon.py`** — tenký entrypoint, žádná logika. (Pokud feature nemá
   dlouho běžící smyčku/proces, tento soubor možná nedává smysl stejně.)
2. **`mqtt.py`** — broker napojení + dispatch, volá `service.py`.
3. **`service.py`** — business logika na vyžádání, volá `driver.py`
   (pokud feature řídí hardware) a/nebo `data/*`.
4. **`driver.py`** — jen pokud feature mluví s hardwarem přímo (subprocess,
   sériová linka, GPIO, …). Features bez hardwaru (`scenes`, `modules`) tento
   soubor nebudou mít.
5. **`constants.py`** — všechny konstanty feature na jednom místě (VCP/HW
   kódy, MQTT topicy, …), `driver.py`/`mqtt.py`/`service.py` z něj importují
   jmenovitě. Žádná logika.
6. **`.service` jako šablona** — `sed` substitucí placeholderů, ne generování
   heredokem — pokud se u té feature nerozhodne jinak.
7. **Společné závislosti** (knihovny používané napříč features) patří do
   top-level `backend/setup.sh`, ne duplikované v každé feature.

Status: **implementováno.** Split proveden přesně podle tohoto dokumentu:

- `constants.py`, `driver.py`, `service.py`, `mqtt.py` (nově nese i
  `DisplayMqtt` broker-dispatch třídu), zeslabený `daemon.py` entrypoint.
- `display.service` je šablona (`__USER__`, `__GROUP__`, `__BACKEND_DIR__`,
  `__PYTHON__`); `setup.sh` ji substituuje `sed`em místo volání
  `install_unit()`.
- `pip_install paho-mqtt` odstraněn z `display/setup.sh`, přesunut do
  top-level `backend/setup.sh` (vedle `install_sudoers`/`init_db`).
- `smartmirror/control/profile_changed` zaveden jako nový globální topic;
  `smartmirror/display/control/profile` a `smartmirror/display/config`
  zrušeny (core timeout handling je mimo scope, řeší se později).
- Testy v `features/tests/test_device_config_wiring.py` přepsány na nové
  `service.apply_profile()` API (dřívější `publish_config`/`CONFIG` testy
  nahrazeny). Celá sada: **231/231 testů projde.**

Zbývá na Pi (nelze ověřit lokálně): skutečný `ddcutil` běh, reálný systemd
restart s novým `display.service`, a napojení `smartmirror/control/profile_changed`
na toho, kdo ho bude publikovat (profil-detekční strana zatím neexistuje —
display je teď připraven naslouchat, ale nic na ten topic ještě nepublikuje).

Další krok: refactor další feature (`radar/` nebo dle priority) stejným
vzorem.
