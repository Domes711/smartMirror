# Databáze `smartmirror.db` — navrhované schéma

> **Stav:** tento dokument popisuje **cílové schéma po refactoru**, ne to, co je
> dnes v `backend/shared/db.py`. Kód zatím nemění nic — `_m001_initial` je
> pořád jediná migrace. Rozdíly proti dnešnímu stavu jsou vyznačené jako
> **ZMĚNA**, **NOVÉ** nebo **ODSTRANĚNO**.
>
> Soubor: `backend/var/smartmirror.db`, režim **WAL** (čte z něj víc procesů
> současně).
>
> **Ve fázi vývoje se `_m001_initial` edituje na místě.** Pi se při změně
> schématu smaže celé a postaví znovu, takže žádná migrace zachovávající data,
> žádné `ALTER TABLE`, žádný zpětný config. Pravidlo „append-only, vydanou
> migraci needituj" začne platit, až zrcadlo pojede v reálném provozu.

**18 tabulek** + `schema_migrations` (profiles, 4× scene_*, 6× module_*,
camera_photos, 6× *_config). Každá feature vlastní tabulky se svým
prefixem; `profiles` je jediná průřezová.

```
profiles ─────┬──► scene_instances ──┬──► scene_window_entries
              │                      └──► scene_default_entries
              ├──► scene_windows ────────► scene_window_entries
              ├──► camera_photos
              (profiles.is_default = 1 → profil pro nerozpoznaného uživatele)

module_catalog ┬──► module_fields
(PK = id)      ├──► module_screenshots
               ├──► module_tags
               └──◄ scene_instances          (FK na id, ne na type)

module_install_jobs   (bez vazeb)

hardware config — jedna key-value tabulka na zařízení,
  řádek s profile='default' = výchozí, profile='<jméno>' = override:
  radar_config       ZMĚNA (přidán profile)
  camera_config      NOVÉ  (jen defaulty — čte se před rozpoznáním profilu)
  monitor_config     NOVÉ
  distance_config    NOVÉ  (zatím bez parametrů)
  mic_config         NOVÉ  (zatím bez parametrů)
  speaker_config     NOVÉ  (zatím bez parametrů)
```

### Souhrn změn proti dnešnímu stavu

| co | změna | proč |
|---|---|---|
| `profiles.builtin` | **ZMĚNA** → `is_default` | `builtin` popisoval nesmazatelnost (důsledek), `is_default` popisuje roli: profil pro nerozpoznaného uživatele. Právě jeden řádek, vynuceno partial unique indexem |
| `scene_instances.type` | **ZMĚNA** → `module_id` INTEGER FK | `type` byl volný text bez FK — šlo uložit instanci neexistujícího modulu |
| `scene_instances.config_json` | **ODSTRANĚNO** | mrtvý sloupec, vždy `{}` |
| `module_catalog.type` | **ODSTRANĚNO**, PK → `id` | `type` byl nejednoznačný a shodný s `module_name` |
| `module_catalog.scope` | **ZMĚNA** → `category` | jméno odpovídá tomu, co to je i co appka dostává |
| `module_catalog.source` | **ZMĚNA** | `builtin` sloučen do `custom`; zbývá `custom` / `installed` / `community` |
| `module_catalog.remote_image` | **ZMĚNA** → `module_images` | obrázků může být víc, takže vlastní tabulka |
| `module_fields.module_type` | **ZMĚNA** → `module_id` FK | vazba přes `id` |
| `module_screenshots.module_type` | **ZMĚNA** → `module_id` FK | vazba přes `id` |
| `module_tags.module_type` | **ZMĚNA** → `module_id` FK | vazba přes `id` |
| `camera_config`, `monitor_config`, `distance_config`, `mic_config`, `speaker_config` | **NOVÉ** | konfigurace HW per zařízení — key-value, `profile = 'default'` jsou defaulty |
| `radar_config` | **ZMĚNA** | přidán `profile` + `id`, aby měl stejný tvar jako ostatní |
| per-profil override | **NOVÉ** | řádek se jménem profilu ve **stejné** tabulce přepíše default jen u svého `key`. Kamera override nemá |

---

## `profiles` — lidé, které zrcadlo zná

Průřezová tabulka. FK do ní mají **camera** (natrénované tváře) i **scenes**
(layouty per profil), takže smazání člověka kaskádou smaže i jeho scény a
fotky. Proto je to skutečný řádek s FK integritou, ne „existující složka
v `dataset/`".

| sloupec | typ | popis |
|---|---|---|
| `name` | TEXT **PK** | jméno osoby, zároveň klíč. Používá se v cestách (`dataset/<name>/`) |
| `is_default` | INTEGER NOT NULL, default `0` | **ZMĚNA** (dřív `builtin`) — `1` = tenhle profil se použije, **když není nikdo rozeznán**. Právě jeden řádek v tabulce ho má |
| `created_at` | TEXT, default `datetime('now')` | kdy vznikl |

**Právě jeden výchozí profil vynucuje schéma**, ne appka:

```sql
CREATE UNIQUE INDEX idx_one_default ON profiles(is_default) WHERE is_default = 1;
```

Partial unique index propustí libovolně mnoho řádků s `0`, ale jen jeden s `1`.
Výchozí profil se za běhu nepřepíná (zakládá ho migrace), takže index je
pojistka proti chybě v migraci nebo ruční editaci DB, ne ochrana proti race.

### ZMĚNA: `builtin` → `is_default`

Starý `builtin` znamenal „vestavěný profil, nelze smazat" a měl ho jen
`default`. Problém nebyl ve tvaru (příznak na řádku), ale ve **významu**:
popisoval nesmazatelnost, což je důsledek, ne vlastnost. Proč je ten profil
nesmazatelný, se ze sloupce nedalo přečíst.

`is_default` pojmenovává skutečnou roli: *tenhle profil se použije, když
kamera nikoho nerozpozná*. Nesmazatelnost z toho vyplývá (zrcadlo se nemá kam
přepnout, kdyby zmizel), ale vynucuje se v kódu při mazání — kontrola
`is_default = 1` místo `builtin = 1`, takže dopad na `camera/profiles.py` je
přejmenování jedné podmínky.

### Výchozí profil je normální profil

Profil s `is_default = 1` se zobrazí, **když není nikdo rozeznán** (probuzení
než face-reco dobehne, `user_unknown`). Má přitom **svoje vlastní instance
a scény jako kdokoliv jiný**:

| tabulka | řádky výchozího profilu |
|---|---|
| `scene_instances` | `profile = 'default'` — vlastní instance s vlastním `values_json`. Díky `UNIQUE (module_id, profile)` má `default` svůj `clock` a Dominik svůj, nezávisle |
| `scene_windows` | `profile = 'default'` — vlastní časová okna, takže „co se v jaký čas zobrazí" se u něj nastavuje stejně jako u ostatních |
| `scene_default_entries` | `profile = 'default'` — vlastní layout, když žádné okno neplatí |
| `camera_photos` | žádné — výchozí profil se nerozpoznává, používá se právě když rozpoznání selže |

V kódu ani v appce proto není pro výchozí profil zvláštní cesta; je to profil
jako každý jiný, jen má nastavený příznak. Migrace zakládá
`('default', is_default=1)`.

---

## `scene_instances` — nakonfigurované moduly

**Instance = nakonfigurovaný modul patřící jednomu profilu.** Trojvrstvý model:

- `module_catalog` — co je **k dispozici** (jeden řádek na modul)
- `scene_instances` — co je **nastavené** (jeden řádek na modul + profil)
- `scene_*_entries` — **kde a kdy** se to zobrazí

Instalace modulu ho naklonuje a nenakonfiguruje nic. Instanci vytvoří až
přidání modulu do scény — pod profilem, který ho přidal. Druhý profil, který
přidá tentýž modul, neklonuje znovu; dostane **vlastní instanci s vlastními
hodnotami** (personalizovaný modul jako mail potřebuje per osobu jiné
přihlašovací údaje).

| sloupec | typ | popis |
|---|---|---|
| `id` | TEXT **PK** | identifikátor instance. **Hlavní rozdíl našeho forku** — upstream MagicMirror `id` nemá. `pages.js` podle něj odkazuje instance a `projectLayout()` podle něj hýbe DOM |
| `module_id` | INTEGER NOT NULL → `module_catalog(id)` ON DELETE CASCADE | **ZMĚNA** — který modul z katalogu. Dřív volný text `type` bez FK |
| `profile` | TEXT NOT NULL → `profiles(name)` CASCADE | vlastník instance |
| `values_json` | TEXT, default `'{}'` | **surové hodnoty z formuláře** v appce. Editor si z nich znovu naplní formulář. Jediný pravdivý zdroj konfigurace |
| `placement` | TEXT, default `'region'` | `region` = pozicuje profile systém podle `pages.js`; `overlay` = modul si řídí DOM sám (dnes jen `alert`) |
| `created_at` | TEXT, default `datetime('now')` | kdy instance vznikla |

**Constrainty**
- `UNIQUE (module_id, profile)` — jedna instance modulu na profil. Dvě mailové
  schránky pro jednoho člověka jsou záměrně mimo rozsah.
- `INDEX idx_instances_profile (profile)`
- `INDEX idx_instances_module (module_id)` — **NOVÉ**, kvůli JOINu na katalog

### ZMĚNA: `type` → `module_id` (FK)

Dnes je `type` TEXT bez FK s komentářem „odpovídá `module_catalog.type`, ale
není to FK". Důsledky, které tím odpadnou:

- šlo uložit instanci modulu, který v katalogu není (typo = tichá nefunkční instance)
- odinstalování modulu nechávalo osiřelé instance, protože CASCADE nebyla kam navázat
- přejmenování modulu v katalogu rozvázalo instance
- každý JOIN se dělal na text, ne na integer PK

Po změně smazání modulu z katalogu kaskádou smaže jeho instance a ty kaskádou
své `scene_*_entries` — řetěz úklidu je kompletní a vynucený schématem.

### ODSTRANĚNO: `config_json`

`values_json` drží, co uživatel zadal. To, co dostane MagicMirror, se z toho
**derivuje** funkcí `codegen.module_config()`:

```
values_json: {"lat": 49.195, "lon": 16.608, "apiKey": "…"}
        ↓ module_config("weather", values)
modules.js:  {"weatherProvider": "openmeteo", "type": "current", "lat": …}
```

Většina modulů bere hodnoty naplocho, pár je potřebuje přebalit (`newsfeed`
chce `feeds: [{title, url}]`, `MMM-GoogleCalendar` chce `calendars: [{…}]`).

`config_json` měl být cache téhle derivace, ale **je prázdný u všech řádků,
vždy**. `store.save()` ho plní z `inst.get("config")`, ale příchozí payload
`config` nikdy nenese — `load()` ho nevrací (není v SELECTu) a editor posílá
`values`. Takže se vždy zapíše `{}` a `codegen` derivuje z `values`.

Cache by navíc byla past: po opravě mapování v `module_config()` by existující
instance dál dostávaly starou podobu, dokud by je uživatel neuložil znovu.

### `placement` podrobně (**zůstává**)

| hodnota | co se stane |
|---|---|
| `region` | DOM se při startu postaví do skrytého stagingu `#mm-hot-staging`; `projectLayout()` ho za běhu přesouvá do regionu podle aktivního layoutu. Když instance v layoutu není, skryje se (lockString `mm-profile`) |
| `overlay` | Vynechá se **na dvou místech**: `createDomObjects` ho nestaví do stagingu (`main.js:162`) a `projectLayout` s ním nehýbe ani ho neskrývá (`main.js:28`). Modul si vykresluje vlastní popup kdekoli |

**Ano, dnes je `overlay` jen kvůli `alert`u** — kdyby ho profile systém nacpal
do regionu a skryl (protože v layoutu není), notifikace by nebyly nikdy vidět.
Sloupec ale **zůstává**, protože to není hack pro jeden modul, ale obecný
kontrakt: každý budoucí modul, který si řídí vlastní DOM (toast, celoobrazovkový
overlay, modál), ho bude potřebovat. Kdyby se zrušil, chování `alert`u by se
muselo zadrátovat jménem modulu do jádra — to je horší.

**Není to `position`.** `placement` říká **jestli** se pozicuje, ne **kam**.
Kam → výhradně `pages.js`, per `(profil, časové okno)`. Proto tu sloupec
`position` není; upstream MagicMirror ho v `config.js` má, náš fork ho zrušil.

---

## `scene_windows` — časová okna

Jedno okno = pojmenovaný časový úsek jednoho profilu, ve kterém platí určitý
layout. Aktivní okno = to, jehož `from` naposledy „spadlo" a zároveň později
než jeho `to`. Při remíze vyhrává pozdější `from`. **Bez změn.**

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `profile` | TEXT NOT NULL → `profiles(name)` CASCADE | čí okno to je |
| `window_name` | TEXT NOT NULL | klíč okna, končí v `pages.js` jako `<profil>.<window_name>` |
| `from_cron` | TEXT NOT NULL | **5položkový cron** `min hod den měsíc dow` (0 = nedělě) — kdy okno začíná |
| `to_cron` | TEXT NOT NULL | kdy končí |
| `label` | TEXT, default `''` | lidský popisek pro editor (např. „Celý den"). **Do `pages.js` se nepropisuje** — je to jen metadata editoru |

`UNIQUE (profile, window_name)`

Výchozí profil používá tuhle tabulku stejně jako kdokoliv jiný — tím se plní
požadavek „u výchozího profilu půjde nastavit, co se v jaký čas zobrazí".

---

## `scene_window_entries` — co je v okně vidět a kde

Řádek = „tahle instance je v tomhle okně na téhle pozici". **Bez změn.**

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `window_id` | INTEGER NOT NULL → `scene_windows(id)` CASCADE | které okno |
| `instance_id` | TEXT NOT NULL → `scene_instances(id)` CASCADE | která instance |
| `position` | TEXT NOT NULL | region MagicMirroru — jedna z 11 hodnot (`store.MM_POSITIONS`): `top_bar`, `top_left`, `top_center`, `top_right`, `upper_third`, `middle_center`, `lower_third`, `bottom_left`, `bottom_center`, `bottom_right`, `bottom_bar` |
| `sort` | INTEGER, default `0` | pořadí v rámci regionu |

`INDEX idx_window_entries (window_id)`

Díky CASCADE na `instance_id` smazání instance automaticky uklidí i layouty,
které ji zmiňují — není potřeba ruční úklid.

---

## `scene_default_entries` — výchozí layout profilu

Co se zobrazí, když **žádné okno není aktivní**. V appce je to tlačítko
**Výchozí** u profilu. Stejná struktura jako `scene_window_entries`, jen
místo okna se váže přímo na profil. **Bez změn** — tahle tabulka je výchozí
layout *každého* profilu a nemá nic společného s tím, který profil je
celkově výchozí (to říká `profiles.is_default`).

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `profile` | TEXT NOT NULL → `profiles(name)` CASCADE | čí výchozí layout |
| `instance_id` | TEXT NOT NULL → `scene_instances(id)` CASCADE | která instance |
| `position` | TEXT NOT NULL | region, stejných 11 hodnot |
| `sort` | INTEGER, default `0` | pořadí |

`INDEX idx_default_entries (profile)`

---

## `module_catalog` — co je k dispozici

Jeden řádek na modul. Plní se seedem
(`python3 -m features.modules.seed --community`), ne za běhu.

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | **ZMĚNA** — stabilní numerický klíč. Na něj FK-ují `scene_instances`, `module_fields`, `module_screenshots`, `module_images`, `module_tags` |
| `module_name` | TEXT NOT NULL **UNIQUE** | **jméno složky** v `MagicMirror/modules/`, které se předá MagicMirroru (`clock`, `MMM-Mail`, …). Prochází validací jména při klonování |
| `label_cs` | TEXT, default `''` | český název pro appku |
| `label_en` | TEXT, default `''` | anglický název (fallback) |
| `description_cs` | TEXT, default `''` | český popis |
| `description_en` | TEXT, default `''` | anglický popis |
| `category` | TEXT, default `''` | **ZMĚNA** (dřív `scope`) — kategorie modulu |
| `source` | TEXT NOT NULL | **ZMĚNA** — `custom` / `installed` / `community`, viz níže |
| `repo_url` | TEXT, default `''` | odkud klonovat. Instalace přijímá **jen** `https://github.com/…` a `https://gitlab.com/…` |
| `maintainer` | TEXT, default `''` | autor z upstream katalogu |
| `stars` | INTEGER, nullable | GitHub stars |
| `installed_at` | TEXT, nullable | kdy nainstalováno (`NULL` = není) |

### ODSTRANĚNO: `type`

`type` byl PK a u **všech** dnešních řádků se rovnal `module_name` — dvě jména
pro jednu věc. Komentář u něj tvrdil, že se oddělují proto, že `type` nemusí
odpovídat ničemu na disku; to je ale ten problém, ne výhoda: klíč, který
„nemusí odpovídat ničemu", nejde použít k nalezení modulu. Identita je teď
`id` (strojová) + `module_name` (co je na disku, UNIQUE). Nic třetího není
potřeba.

### ZMĚNA: `scope` → `category`

Sloupec držel kategorii z upstream katalogu a appce se posílal pod jménem
`category`. Přejmenováním zmizí překlad v půlce cesty.

### ZMĚNA: `source` — `builtin` sloučen do `custom`

| hodnota | co to znamená |
|---|---|
| `custom` | **modul je v našem repu** pod `MagicMirror/modules/<module_name>/` — ať ho napsal uživatel, nebo AI builder. **Je tím i nainstalovaný**: soubory jsou fyzicky na disku, takže instalace neklonuje nic (nejvýš `npm install` závislostí) |
| `installed` | naklonovaný z upstreamu, leží na disku |
| `community` | jen k prohlížení z upstream katalogu, zatím neinstalovaný — **jediný zdroj, který opravdu klonuje** |

**Ano — `custom` implikuje „naklonovaný", repo se neklonuje.** Dřívější
rozdělení `builtin` (v repu, od nás) vs. `custom` (vyrobené AI builderem)
nerozlišovalo nic funkčního: oba případy znamenají „soubory jsou v našem repu,
není co klonovat" a instalační cesta je pro ně identická. `install.py` se tedy
větví jen na `source == 'community'` (klonuj) vs. zbytek (neklonuj).

Do editoru scén jdou jen řádky se `source IN ('custom','installed')` —
`community` jsou browse-only, dokud se nenainstalují (`catalog.placeable()`).

---

## `module_images` — náhledy z upstreamu (**NOVÉ**)

Nahrazuje jednoslotový `module_catalog.remote_image`. Upstream katalog i naše
moduly mohou mít náhledů víc, takže je to vazba 1:N, ne sloupec.

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `module_id` | INTEGER NOT NULL → `module_catalog(id)` CASCADE | čí obrázek |
| `url` | TEXT NOT NULL | URL náhledu |
| `caption` | TEXT, default `''` | titulek |
| `sort` | INTEGER, default `0` | pořadí |

`INDEX idx_module_images (module_id)`

**Rozdíl proti `module_screenshots`:** tady jsou **vzdálené URL** (upstream,
nestahujeme je), tam **lokální soubory** pod `var/module-assets/`. Nejde to
sloučit — jedno se renderuje z internetu, druhé servíruje gateway z disku.

---

## `module_fields` — formulářová pole modulu

Co se uživatele zeptat při přidávání modulu do scény. Hodnoty, které zadá,
skončí v `scene_instances.values_json`.

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `module_id` | INTEGER NOT NULL → `module_catalog(id)` CASCADE | **ZMĚNA** (dřív `module_type` TEXT) — čí pole |
| `key` | TEXT NOT NULL | klíč v `values_json` (`url`, `apiKey`, `stopName`, …) |
| `label_cs` | TEXT, default `''` | český popisek |
| `label_en` | TEXT, default `''` | anglický popisek |
| `required` | INTEGER, default `0` | povinné pole |
| `field_type` | TEXT, default `'text'` | typ widgetu. Reálně v DB: **`text`** a **`brno_stop`** (vlastní picker zastávky na mapě) |
| `placeholder` | TEXT, default `''` | nápověda v prázdném poli |
| `help` | TEXT, default `''` | delší vysvětlení |
| `options_json` | TEXT, nullable | možnosti pro select |
| `sort` | INTEGER, default `0` | pořadí ve formuláři |

`UNIQUE (module_id, key)` — **NOVÉ**, dvě pole se stejným klíčem by si
v `values_json` přepsala hodnotu.
`INDEX idx_module_fields (module_id)`

---

## `module_screenshots` — lokální náhledy v obchodě

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `module_id` | INTEGER NOT NULL → `module_catalog(id)` CASCADE | **ZMĚNA** (dřív `module_type` TEXT) |
| `asset_path` | TEXT NOT NULL | cesta k souboru pod `var/module-assets/<module_name>/*.png`. **Binárka zůstává souborem**, v DB je jen odkaz |
| `caption` | TEXT, default `''` | titulek |
| `sort` | INTEGER, default `0` | pořadí |

`INDEX idx_module_shots (module_id)`

---

## `module_tags` — tagy pro filtrování

| sloupec | typ | popis |
|---|---|---|
| `module_id` | INTEGER NOT NULL → `module_catalog(id)` CASCADE | **ZMĚNA** (dřív `module_type` TEXT) |
| `tag` | TEXT NOT NULL | tag |

`PRIMARY KEY (module_id, tag)` — složený klíč, žádné `id`.

---

## `module_install_jobs` — průběh instalace

Instalace klonuje na pozadí, takže potřebuje stav, na který se dá doptat.
Postup se zároveň tlačí na MQTT (`modules/install/progress/<module_name>`).

| sloupec | typ | popis |
|---|---|---|
| `id` | TEXT **PK** | id úlohy |
| `module_name` | TEXT NOT NULL | co se instaluje. **Záměrně bez FK a jako jméno, ne `id`** — úloha má přežít i smazání řádku z katalogu, aby se dala zobrazit historie neúspěšné instalace |
| `status` | TEXT NOT NULL | `running` / `done` / `error` |
| `phase` | TEXT, default `''` | lidská fáze („klonuji", „instaluji závislosti") |
| `percent` | INTEGER, default `0` | 0–100 |
| `started_at` | TEXT, default `datetime('now')` | |
| `finished_at` | TEXT, nullable | |
| `error` | TEXT, nullable | chybová zpráva při `status='error'` |

---

# Konfigurace hardwaru

Každé zařízení má **jednu tabulku `<device>_config`** v podobě **key-value**:
jeden řádek = jeden parametr. Žádné sloupce per parametr, žádná druhá tabulka
na overridy.

## Vzor: default řádky + per-profil override, v jedné tabulce

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `profile` | TEXT NOT NULL, default `''` | `'default'` = **výchozí hodnota** (platí pro všechny), jinak jméno profilu |
| `key` | TEXT NOT NULL | jméno parametru |
| `value` | TEXT NOT NULL | **JSON-kódovaná** hodnota (i čísla) |

`UNIQUE (profile, key)` — jeden parametr jednou na profil.

Příklad obsahu `monitor_config`:

```
id | profile   | key              | value
 1 | 'default' | brightness_day   | 80     ← výchozí, migrace
 2 | 'default' | brightness_night | 20     ← výchozí, migrace
 3 | 'default' | dim_timeout_s    | 30     ← výchozí, migrace
 4 | 'default' | sleep_timeout_s  | 120    ← výchozí, migrace
 5 | 'Dominik' | brightness_night | 5      ← override, jen tenhle klíč
```

Migrace naplní řádky s `profile = 'default'`. Když si uživatel jedno nastavení změní,
přidá se **jeden řádek** s jeho jménem — ostatní parametry dál berou default.

**Resolve: načti defaulty, přepiš je profilem, pošli zařízení.**

```python
def resolve(table, profile):
    cfg = {r["key"]: jload(r["value"]) for r in
           query(f"SELECT key, value FROM {table} WHERE profile = 'default'")}
    cfg.update({r["key"]: jload(r["value"]) for r in
                query(f"SELECT key, value FROM {table} WHERE profile = ?",
                      (profile,))})
    return cfg
```

Profil, který si nic nenastavil, nemá v tabulce žádný řádek → `update()`
nepřepíše nic → dostane čisté defaulty. Žádný speciální případ.

### Proč `'default'` a ne `NULL`

**`UNIQUE` na nullable sloupci v SQLite nehlídá nic** — každý `NULL` se počítá
jako jiná hodnota, takže `UNIQUE (profile, key)` by povolil libovolně mnoho
výchozích řádků pro stejný `key` a resolve by bral jeden z nich náhodně.
Potřebujeme tedy skutečnou hodnotu.

`'default'` je oproti prázdnému stringu lepší ze dvou důvodů:

1. **Čitelnost** — `WHERE profile = 'default'` říká, co dělá; `WHERE profile = ''`
   vypadá jako chyba nebo nedoplněná hodnota.
2. **FK funguje přímo.** Profil `default` v `profiles` **reálně existuje** (zakládá
   ho migrace s `is_default = 1`), takže
   `profile TEXT NOT NULL DEFAULT 'default' REFERENCES profiles(name) ON DELETE CASCADE`
   jde napsat bez výjimek. U `''` by se musel do `profiles` seedovat falešný
   řádek, nebo FK vynechat a integritu dohlížet v kódu.

Navíc tím CASCADE uklidí overridy smazaného profilu samo. Profil s
`is_default = 1` nelze smazat — tuhle kontrolu dělá kód při mazání.

### Jedna poznámka: `'default'` nese dva významy

`profile = 'default'` znamená zároveň **„výchozí hodnota pro všechny"** a
**„konfigurace profilu `default`"** (ten nerozpoznaný uživatel). V praxi to
splývá správně: když u zrcadla někdo stojí a není rozpoznaný, resolve vrátí
výchozí hodnoty — přesně co chceme.

Důsledek, který je dobré vědět: **nerozpoznanému uživateli nelze dát jiné
nastavení než globální výchozí**, protože by to byl tentýž řádek. Kdyby to
někdy bylo potřeba (např. nerozpoznanému záměrně tlumit jas), musel by se
zavést druhý sentinel nebo se vrátit k `NULL` + partial unique indexu.

### Proč jsou `key` a `value` NOT NULL

Jen `profile` je „volitelný". Řádek bez `key` nebo bez `value` nemá význam —
nenastavená hodnota se nevyjadřuje `NULL`em ve sloupci, ale **neexistencí
řádku**. Proto tu nejsou nullable sloupce per parametr.

## Kde override smysl má a kde ne

Rozhodující je, **jestli ten, kdo parametr čte, v tu chvíli zná profil**:

| zařízení | override | proč |
|---|---|---|
| `monitor` | **ano** | o dimming/sleep rozhoduje `profile.js` (`js/profile.js:192-198`), které profil zná (`this.currentUser`) |
| `mic` | **ano** | citlivost, wake word, jazyk jsou per osobu |
| `speaker` | **ano** | hlasitost, výstupní zařízení jsou per osobu |
| `radar` | **ano** | zóna sama je fyzická, ale citlivost / zpoždění probuzení si profil přepsat může |
| `distance` | **ano** | až bude známo, co měřič umí; tabulka je na to připravená |
| `camera` | **ne — jen defaulty** | parametry se čtou **než se ví, kdo tam stojí**: `daemon.py` skenuje tvář právě proto, aby profil zjistil. Per-profil `recognition_tolerance` je logicky nemožná — musel bys znát profil, abys věděl, s jakou tolerancí ho rozpoznat. `rotation` a rozlišení jsou navíc fyzická vlastnost montáže |

**Kamera je jediná výjimka** a je principiální, ne z lenosti: je to zařízení,
které profil *určuje*, takže se na něj nemůže nastavit. Má stejnou strukturu
jako ostatní, jen se do ní nikdy nezapíše řádek s jiným `profile` než `'default'`.

Jinak řečeno: override jde na zařízení, která reagují na **už známého**
uživatele; kamera běží dřív, než je komu se přizpůsobit.

---

## `radar_config` — kalibrace radaru (**ZMĚNA**: přidán `profile`)

Už dnes je key-value, takže se jen rozšíří o `profile` + `id` a dostane
stejný tvar jako ostatní. Existující řádky migrace přepíše na `profile = 'default'`.

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | **NOVÉ** (dřív `key` byl PK) |
| `profile` | TEXT NOT NULL, default `''` | `''` = default |
| `key` | TEXT NOT NULL | jméno parametru |
| `value` | TEXT NOT NULL | JSON-kódovaná hodnota |

`UNIQUE (profile, key)`

Defaulty drží kalibraci zóny — filtr cílů `abs(x) ≤ 400mm AND 0 < y ≤ 1500mm`.
Kalibrace **zóny** se per profil nastavovat nemá (je fyzická vlastnost
místnosti); override má smysl u citlivosti nebo zpoždění probuzení.

## `camera_config` — konfigurace kamery (**NOVÉ**)

Stejný tvar, ale **jen řádky s `profile = 'default'`** — kamera override nemá.

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `profile` | TEXT NOT NULL, default `'default'` → `profiles(name)` CASCADE | u kamery vždy `'default'` |
| `key` | TEXT NOT NULL | jméno parametru |
| `value` | TEXT NOT NULL | JSON-kódovaná hodnota |

`UNIQUE (profile, key)`

Parametry, které migrace naplní:

| `key` | default | dnes v kódu |
|---|---|---|
| `rotation` | `180` | zadrátováno `cv2.ROTATE_180`, `supervisor.py:280` — kamera je namontovaná vzhůru nohama |
| `resolution_width` | `640` | `set_resolution()`, `supervisor.py:158` |
| `resolution_height` | `480` | tamtéž |
| `framerate` | `15` | |
| `recognition_timeout_s` | `3.0` | `DEFAULT_MAX_DURATION`, `daemon.py:39` |
| `recognition_tolerance` | `0.5` | `DEFAULT_TOLERANCE`, `daemon.py:236` |

## `monitor_config` — konfigurace monitoru (**NOVÉ**)

Dell U2515H přes DDC/CI (`ddcutil`), bez GPIO. Stejný tvar, override povolen.

| `key` | default | dnes v kódu |
|---|---|---|
| `brightness_day` | `80` | |
| `brightness_night` | `20` | |
| `dim_timeout_s` | `30` | `DEFAULT_DIM_MS`, `js/profile.js:195` |
| `sleep_timeout_s` | `120` | |
| `ddc_bus` | `""` | I²C bus (`""` = autodetekce) |

`ddc_bus` je vlastnost kabelu, ne osoby — override se u něj nemá nastavovat
(schéma to nezakazuje, je to konvence).

## `distance_config` — nový měřič vzdálenosti (**NOVÉ**, zatím bez parametrů)

Tabulka se zakládá prázdná, aby existovala dřív, než se zařízení připojí.
Parametry přijdou další migrací, až bude známo, co měřič umí.

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `profile` | TEXT NOT NULL, default `'default'` → `profiles(name)` CASCADE | |
| `key` | TEXT NOT NULL | |
| `value` | TEXT NOT NULL | |

`UNIQUE (profile, key)`

## `mic_config` — mikrofon (**NOVÉ**, zatím bez parametrů)

Stejný tvar jako `distance_config`. Čekané parametry: citlivost, wake word,
jazyk — všechny s per-profil overridem.

## `speaker_config` — reproduktor (**NOVÉ**, zatím bez parametrů)

Stejný tvar. Čekané parametry: hlasitost, výstupní zařízení — s overridem.

> Pojmenováno `speaker_config` (ne `reproductor_config`): `reproductor` je
> španělsky, v angličtině to nic neznamená a zbytek schématu je anglicky.
> Řekni, jestli chceš přesto `reproductor_config`.

---

## `camera_photos` — trénovací fotky

Fotky pro rozpoznávání tváří. Natrénovaný model samotný je **soubor**
(`var/encoded_faces.pickle`), v DB jsou jen vstupy. **Bez změn.**

| sloupec | typ | popis |
|---|---|---|
| `id` | INTEGER **PK** AUTOINCREMENT | |
| `profile_name` | TEXT NOT NULL → `profiles(name)` CASCADE | čí fotka |
| `file_path` | TEXT NOT NULL | cesta pod `var/dataset/<profil>/` |
| `captured_at` | TEXT, default `datetime('now')` | kdy nasnímáno |

`UNIQUE (profile_name, file_path)`, `INDEX idx_camera_photos (profile_name)`

Počet fotek u profilu se **nepočítá do sloupce**, derivuje se
`COUNT(camera_photos)` (`camera/profiles.py:73`). Tabulka se navíc
„reconciluje" proti disku — soubory jsou pravda, řádky je dohánějí.

---

## `schema_migrations` — evidence migrací

`CREATE TABLE IF NOT EXISTS` mimo migrace (musí existovat dřív než ony).
Drží, které migrace už proběhly.

**Dokud je zrcadlo ve vývoji:** `_m001_initial` se edituje na místě a Pi se
smaže (`nuke-pi.sh`), takže `schema_migrations` zůstává u jediného řádku.
Append-only pravidlo („přidej další `@migration`, vydanou needituj") se zapne,
až bude v DB stát něco, co nejde naklikat znovu.

---

## Co v DB záměrně není

Binární data zůstávají soubory:

| soubor | co to je |
|---|---|
| `var/encoded_faces.pickle` | natrénovaný model tváří |
| `var/dataset/<profil>/*.jpg` | trénovací fotky (v DB jen cesty) |
| `var/module-assets/<module_name>/*.png` | screenshoty do obchodu (v DB jen cesty) |
| `var/module-drafts/` | rozpracované moduly z AI builderu |

---

## Dopad na kód (až se bude implementovat)

Tenhle dokument je návrh; migrace a kód zatím nikdo nepsal. Co se bude muset
změnit, až na to dojde:

| oblast | co |
|---|---|
| `backend/shared/db.py` | **`_m001_initial` přepsat na místě** — nové `CREATE TABLE`, žádné `ALTER`/kopírování dat. Plus `idx_one_default` a seed HW defaultů |
| `features/modules/catalog.py`, `install.py`, `seed.py` | `type` → `id` + `module_name`, `scope` → `category`, `builtin` → `custom`, `remote_image` → `module_images` |
| `features/scenes/store.py`, `codegen.py` | instance se adresují přes `module_id`; `module_config()` bere `module_name`; zmizí zápis `config_json` |
| `features/camera/profiles.py` | `builtin` → `is_default` (přejmenování podmínky při mazání) |
| `features/camera/supervisor.py` | rotace 180° z `camera_config` (`supervisor.py:280`), ne z konstanty |
| `features/camera/daemon.py` | `DEFAULT_MAX_DURATION` / `DEFAULT_TOLERANCE` z `camera_config` |
| `features/display/daemon.py` | jas z `monitor_config` resolvnutý pro aktivní profil |
| `features/radar/daemon.py` | `radar_config` má teď `profile` + `id`; dnešní čtení podle `key` jako PK se musí přepsat na `WHERE profile = 'default'` |
| `MagicMirror/js/profile.js` | `DEFAULT_DIM_MS` (`profile.js:195`) → `dim_timeout_s` resolvnutý pro `currentUser`; **při změně profilu se timeouty musí přepočítat**, dnes se nastaví jednou |
| nová `shared/` helper | `resolve_config(table, profile)` — načti `profile='default'`, přepiš profilem. Jedna funkce pro všech 6 zařízení |
| pořadí v migraci | řádky `profile = 'default'` v HW configu se musí vkládat **po** profilu `default`, jinak FK selže |
| `frontend/` | API posílá `module_id` / `category` / `module_images[]` místo `type` / `scope` / `remote_image` |
| testy | `backend/` suita jede na schématu, takže projdou až po migraci + úpravě kódu |

---

# Datová vrstva: `backend/data/`

Dnes je SQL rozeseté po featurách — `features/scenes/store.py` (19 dotazů),
`features/modules/catalog.py` (18), `features/camera/profiles.py` (10),
`features/modules/install.py` (4), `features/radar/config.py` (3). Mění-li se
sloupec, hledá se, kdo na něj sahá.

Nová vrstva to sbírá na jedno místo: **`backend/data/`, jeden soubor na
tabulku**, pojmenovaný podle ní.

```
backend/data/
  __init__.py
  profiles.py              profiles
  scene_instances.py       scene_instances
  scene_windows.py         scene_windows
  scene_window_entries.py  scene_window_entries
  scene_default_entries.py scene_default_entries
  module_catalog.py        module_catalog
  module_fields.py         module_fields
  module_images.py         module_images
  module_screenshots.py    module_screenshots
  module_tags.py           module_tags
  module_install_jobs.py   module_install_jobs
  camera_photos.py         camera_photos
  device_config.py         radar_ / camera_ / monitor_ / distance_ /
                           mic_ / speaker_config — jeden modul, viz níže
```

## Pravidla

1. **Jeden soubor = jedna tabulka.** Jméno souboru je jméno tabulky, takže
   cesta od sloupce ke kódu je mechanická.
2. **SQL žije jen tady.** Mimo `data/` se neobjeví `SELECT` ani `INSERT` —
   feature volá funkci, ne dotaz.
3. **Funkce vrací `dict` / `list[dict]`, ne `sqlite3.Row`.** Volající nemá
   vědět, že pod tím je SQLite.
4. **Žádná business logika.** Validace, derivace configu
   (`codegen.module_config()`) a MQTT zůstávají ve featuře; `data/` umí jen
   čtení a zápis.
5. **Transakce patří volajícímu.** Funkce v `data/` jsou jednotlivé operace;
   kdo potřebuje atomicitu, obalí je `with db.tx():`. Jinak by se víc zápisů
   nedalo spojit do jedné transakce.
6. **`shared/db.py` zůstává** — connection, WAL, migrace, `tx`, `jload` /
   `jdump`. `data/` ho používá, nenahrazuje.

## Tvar modulu

```python
# backend/data/profiles.py
"""profiles — lidé, které zrcadlo zná."""
from shared import db

def list_all() -> list[dict]:
    return [dict(r) for r in db.query(
        "SELECT name, is_default, created_at FROM profiles ORDER BY is_default DESC, name")]

def get(name: str) -> dict | None:
    r = db.one("SELECT name, is_default, created_at FROM profiles WHERE name = ?", (name,))
    return dict(r) if r else None

def create(name: str) -> None:
    db.connect().execute("INSERT INTO profiles(name) VALUES (?)", (name,))

def delete(name: str) -> None:
    db.connect().execute("DELETE FROM profiles WHERE name = ?", (name,))

def is_default(name: str) -> bool:
    r = db.one("SELECT is_default FROM profiles WHERE name = ?", (name,))
    return bool(r and r["is_default"])
```

**Žádný `set_default()`.** Výchozí profil je `default`, zakládá ho migrace
a za běhu se nepřepíná — kdyby to někdy bylo potřeba, je to `UPDATE` dvou
řádků v jedné transakci (index nepustí dvě jedničky), ale dokud to appka
neumí nabídnout, byla by to mrtvá funkce.

Kontrola „výchozí profil nelze smazat" **do `data/` nepatří** — je to pravidlo,
ne přístup k datům. Patří do `features/camera/profiles.py`, které si zavolá
`data.profiles.is_default()`.

## `device_config.py` — výjimka z pravidla

Šest HW tabulek (`radar_config`, `camera_config`, `monitor_config`,
`distance_config`, `mic_config`, `speaker_config`) má **identické schéma**
(`id`, `profile`, `key`, `value`). Šest souborů s týmž kódem by byl copy-paste,
takže je obsluhuje jeden modul s parametrem tabulky:

```python
# backend/data/device_config.py
TABLES = {"radar", "camera", "monitor", "distance", "mic", "speaker"}

def _table(device: str) -> str:
    if device not in TABLES:          # whitelist: jméno tabulky jde do SQL
        raise ValueError(f"unknown device: {device}")
    return f"{device}_config"

def resolve(device: str, profile: str = "default") -> dict:
    """Výchozí hodnoty, přepsané overridem profilu. Viz Konfigurace hardwaru."""
    t = _table(device)
    cfg = {r["key"]: db.jload(r["value"]) for r in db.query(
        f"SELECT key, value FROM {t} WHERE profile = 'default'")}
    if profile != "default":
        cfg.update({r["key"]: db.jload(r["value"]) for r in db.query(
            f"SELECT key, value FROM {t} WHERE profile = ?", (profile,))})
    return cfg

def set_value(device: str, key: str, value, profile: str = "default") -> None:
    db.connect().execute(
        f"INSERT INTO {_table(device)}(profile, key, value) VALUES (?,?,?) "
        "ON CONFLICT(profile, key) DO UPDATE SET value = excluded.value",
        (profile, key, db.jdump(value)))
```

Jméno tabulky nejde parametrizovat `?`, proto ten **whitelist** — bez něj by
`device` z HTTP/MQTT payloadu byl SQL injection.

## Co se bude muset přepsat

| soubor | dnes | po změně |
|---|---|---|
| `features/scenes/store.py` | 19 dotazů | volá `data.scene_*`; zůstane validace pozic (`MM_POSITIONS`) a skládání layoutu |
| `features/modules/catalog.py` | 18 dotazů | volá `data.module_*`; zůstane `placeable()` a tvarování odpovědi pro appku |
| `features/camera/profiles.py` | 10 dotazů | volá `data.profiles` + `data.camera_photos`; zůstane reconcile proti disku a odmítnutí smazat profil s `is_default` |
| `features/modules/install.py` | 4 dotazy | volá `data.module_install_jobs` |
| `features/radar/config.py` | 3 dotazy | volá `data.device_config` s `device="radar"` |
| `features/modules/seed.py` | 1 dotaz | volá `data.module_catalog` |
| `features/scenes/codegen.py` | čte přes `store` | bez změny — `module_config()` je derivace, zůstává |

Testy: `data/` je testovatelná proti dočasné DB bez MQTT a HTTP, takže sem
patří i testy schématu (FK kaskády, partial unique index, `ON CONFLICT`
upsert). Dnešní testy featur zůstávají tam, kde jsou.

**Pořadí prací:** přepsat `_m001_initial` → `data/` + testy → přepojení featur
→ HW configy a `profile.js`. `data/` se dá napsat a otestovat dřív, než se
featury dotknou.

Na Pi se to nasadí smazáním DB (`nuke-pi.sh` nebo ručně
`rm backend/var/smartmirror.db*`) a `./setup.sh` — katalog se vrátí seedem,
scény se naklikají znovu.
