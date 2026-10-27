# Repository layer nad SQLite — návrh

**Stav:** návrh k odsouhlasení
**Datum:** 2026-10-24
**Branch:** `refactor-be`

## Problém

`shared/db.py` dnes nabízí jen primitiva (`query`, `one`, `tx`, `jload`,
`jdump`) a **každá feature si píše SQL sama**. Reálný stav:

| SQL statementů | Soubor |
|---|---|
| 19 | `features/scenes/store.py` |
| 18 | `features/modules/catalog.py` |
| 10 | `features/camera/profiles.py` |
| 4 | `features/modules/install.py` |
| 3 | `features/radar/config.py` |
| 1 | `features/modules/seed.py` |
| 1 | `features/scenes/service.py` |

Z toho plynou čtyři konkrétní bolesti — všechny ověřené v kódu, ne hypotetické:

### 1. `profiles` je cross-cutting tabulka bez vlastníka

`profiles` je podle CLAUDE.md *"the one cross-cutting table"* — FK do ní mají
`camera` (natrénované tváře) i `scenes` (layouty). Dnes ji ale **vlastní
scenes**, takže camera si na ni musí sahat přes feature hranici:

```python
# features/camera/profiles.py:59
def ensure(name: str) -> None:
    from features.scenes.store import ensure_profile   # ← camera → scenes
    ensure_profile(_check_name(name))

# features/camera/profiles.py:91
def remove(name: str) -> dict:
    from features.scenes.store import remove_profile   # ← camera → scenes
```

Import je navíc **lazy uvnitř funkce**, což je obejití cyklu, ne design.

### 2. Duplikovaná logika

Tentýž upsert existuje dvakrát, nezávisle:

```python
# features/scenes/store.py:57
sql = "INSERT OR IGNORE INTO profiles(name, builtin) VALUES (?, ?)"
args = (name, 1 if name == DEFAULT_PROFILE else 0)

# features/camera/profiles.py:123
conn.execute("INSERT OR IGNORE INTO profiles(name, builtin) "
             "VALUES (?, ?)",
             (name, 1 if name == DEFAULT_PROFILE else 0))
```

A `DEFAULT_PROFILE = "default"` je definované taky dvakrát
(`scenes/store.py:23`, `camera/profiles.py:30`). Když se změní pravidlo pro
`builtin`, musí se najít obě místa.

### 3. Sloupec, do kterého se jen zapisuje

`scene_instances.config_json` se **zapisuje** (`store.py:154`), je ve schématu
(`db.py:133`), ale `load()` ho **nečte** — SELECT na `store.py:83` bere jen
`id, type, profile, values_json, placement`. Ověřeno spuštěním: zapsaný
`{"MARKER": "written-to-db"}` v DB leží, ale po `load()` je `config` → `None`.

Komentář v `codegen.py:86` ("*materialised at save time; fall back to deriving
it*") je proto nepravdivý — fallback je jediná cesta. Tohle je přesně typ
nekonzistence, kterou roztroušené SQL umožňuje: zápis a čtení jsou 70 řádků od
sebe a nikdo je nedrží v souladu.

### 4. Business logika je slepená se SQL

`store.save()` (`store.py:118-192`) je 75 řádků, kde se střídá SQL s
rozhodováním (které profily smazat, jak zahodit dangling reference). Nejde
otestovat zvlášť a nejde přečíst jako pravidlo.

## Cíl

```
features/  ← business logika, žádné SQL
    ↓ volá
repositories/  ← mapování tabulka ↔ dict, veškeré SQL
    ↓ volá
shared/db.py  ← connection, WAL, migrace, tx (bez změny)
```

**Pravidlo:** `SELECT`/`INSERT`/`UPDATE`/`DELETE` se smí objevit **jen** v
`repositories/`. Feature, která chce data, volá metodu repozitáře.

## Návrh struktury

```
backend/
  shared/
    db.py                  — bez změny (connect, tx, query, one, migrace)
  repositories/
    __init__.py            — re-export instancí
    base.py               — Repository base: _row_to_dict, tx helper
    profiles.py           — ProfileRepository       (profiles)           ★ sdílený
    scene_instances.py    — SceneInstanceRepository (scene_instances)
    scene_layout.py       — SceneLayoutRepository   (scene_windows,
                                                     scene_window_entries,
                                                     scene_default_entries)
    module_catalog.py     — ModuleCatalogRepository (module_catalog,
                                                     module_fields,
                                                     module_screenshots,
                                                     module_tags)
    module_jobs.py        — ModuleJobRepository     (module_install_jobs)
    camera_photos.py      — CameraPhotoRepository   (camera_photos)
    radar_config.py       — RadarConfigRepository   (radar_config)
```

**Proč `repositories/` vedle `shared/`, a ne `shared/repositories/`:**
`shared/` je dnes popsané jako *"the only shared pieces"* — infrastruktura
(db, mqtt, http, paths). Repozitáře nejsou infrastruktura, jsou datová vrstva
domény. Oddělením zůstane čitelné, co je technický základ a co datový model.

**Proč 7 repozitářů a ne 12 (jeden na tabulku):** hranice je **agregát**, ne
tabulka. `scene_windows` + `scene_window_entries` + `scene_default_entries`
nemají samostatný život — zapisují se vždy spolu, v jedné transakci. Totéž
`module_catalog` + jeho tři satelitní tabulky. Repozitář na tabulku by znamenal,
že transakční hranici musí držet volající, což je právě to, čeho se chceme
zbavit.

## Jak to řeší ty čtyři bolesti

### `profiles` dostane vlastníka

```python
# repositories/profiles.py
DEFAULT_PROFILE = "default"          # ← jediná definice

class ProfileRepository(Repository):
    """Vlastník cross-cutting tabulky `profiles`.

    Camera (natrénované tváře) i scenes (layouty) do ní FKují. Žádná z nich
    ji nevlastní — vlastní ji tenhle repozitář, takže ani jedna nemusí
    importovat druhou.
    """

    def ensure(self, name: str, conn=None) -> None:
        """Upsert — layout může vzniknout před enrollmentem tváře i naopak."""

    def list_names(self) -> list[str]: ...
    def list_with_photo_counts(self) -> list[dict]: ...
    def remove(self, name: str) -> None:
        """ON DELETE CASCADE smaže i scény a fotky daného člověka."""
```

Pak oba cross-feature importy zmizí:

```python
# features/camera/profiles.py — PŘED
def ensure(name):
    from features.scenes.store import ensure_profile    # camera → scenes
    ensure_profile(_check_name(name))

# PO
from repositories import profiles as profile_repo
def ensure(name):
    profile_repo.ensure(_check_name(name))              # camera → repository
```

Stejně `features/modules/install.py:143` (`from features.scenes import
codegen, store as scene_store`) — uninstall potřebuje smazat scene instance
daného typu, což je `scene_instances.delete_by_type(mtype)`, ne volání do
scenes feature.

### Duplikace a write-only sloupec

Upsert bude na jednom místě. A `config_json` se vyřeší při psaní repozitáře —
protože zápis i čtení budou v jednom souboru vedle sebe, nesrovnalost bude
viditelná. Doporučení (z předchozí analýzy): **sloupec přestat plnit**,
protože `module_config()` musí derivovat vždy — když se opraví mapování pro
`weather`, má se to projevit i na existujících instancích; cached config by
držel starou podobu. Migrace jsou append-only, takže sloupec ve schématu
zůstane, jen se do něj přestane zapisovat.

### Business logika se oddělí

`store.save()` se rozpadne:

```python
# repositories/scene_layout.py — JEN data
class SceneLayoutRepository(Repository):
    def replace_all(self, defaults: dict, windows: dict,
                    known_ids: set, conn) -> None:
        """Smaže a znovu zapíše všechny layout řádky. `known_ids` filtruje
        dangling reference — volající rozhoduje, co je známé."""

# features/scenes/store.py — JEN pravidla
def save(store: dict) -> None:
    with db.tx() as conn:
        for name in _profiles_in(store):
            profile_repo.ensure(name, conn)

        # Pravidlo: save nese jen některé profily; smazat všechny instance
        # by vymazalo ostatním profilům moduly i s credentials.
        for profile in _touched_profiles(store):
            instance_repo.replace_for_profile(profile, ..., conn)

        layout_repo.replace_all(..., known_ids=instance_repo.all_ids(conn),
                                conn=conn)
```

Pravidlo "save nese jen některé profily" je pak čitelné jako pravidlo, ne
schované mezi `conn.execute()`.

## Transakce: klíčové rozhodnutí

Repozitáře **nesmí otevírat vlastní transakci**, když je volající uprostřed
své. `store.save()` musí být atomický přes tři repozitáře — kdyby si každý
otevřel `db.tx()`, při selhání třetího zůstanou zápisy prvních dvou.

Proto každá mutující metoda bere **volitelný `conn`**:

```python
def ensure(self, name: str, conn=None) -> None:
    if conn is not None:
        conn.execute(SQL, args)        # účastní se transakce volajícího
    else:
        with db.tx() as c:             # samostatná operace
            c.execute(SQL, args)
```

Tenhle vzor už v kódu je — `scenes/store.py:53` (`ensure_profile(name,
conn=None)`) ho používá. Návrh ho jen zobecňuje na všechny repozitáře, do
`base.py`, místo ad-hoc opakování.

## Modul vs. class

Repozitáře nedrží stav (connection se bere z `db.connect()` per-call, WAL to
umožňuje), takže **class není nutná**. Dvě varianty:

**A. Modul s funkcemi** — v souladu s dnešním stylem backendu
(`radar/config.py`, `modules/catalog.py` jsou modulové funkce):

```python
from repositories import profiles as profile_repo
profile_repo.ensure("dominik")
```

**B. Class + singleton instance** — testovatelnější přes DI, ale v tomhle
kódu by singleton stejně vznikl a dnešní testy si vystačí s `sandbox`
fixturou, která přesměruje cestu k DB.

**Doporučuji A** — stejný tvar jako zbytek backendu, nulová ceremonie, a
`base.py` se zúží na pár helperů (`maybe_tx(conn)`, `row_to_dict`). Pokud
někdy bude potřeba mockovat repozitář, `monkeypatch.setattr` na modul funguje
stejně dobře jako injektovaná instance.

## Dopad na features

| Feature | Dnes | Po změně |
|---|---|---|
| `scenes/store.py` | 263 ř., 19 SQL | ~120 ř., 0 SQL — jen pravidla save/load/validate |
| `modules/catalog.py` | 18 SQL | 0 SQL — volá `module_catalog` repo |
| `camera/profiles.py` | 10 SQL + 2 importy do scenes | 0 SQL, 0 cross-feature importů |
| `modules/install.py` | 4 SQL + import do scenes | 0 SQL, bez importu do scenes |
| `radar/config.py` | 3 SQL | 0 SQL (nejmenší případ, dobrý první krok) |
| `scenes/service.py` | 1 SQL (`SELECT 1 FROM scene_windows`) | `layout_repo.is_empty()` |
| `modules/seed.py` | 1 SQL (`SELECT COUNT(*)`) | `catalog_repo.count()` |
| `scenes/codegen.py` | 0 SQL | bez změny — jen generuje JS z dictu |

Ty dva poslední jsou existenční dotazy ("je layout prázdný?", "kolik je v
katalogu?"). Patří do repozitáře jako pojmenovaná metoda — jinak by hlídací
test (krok 7) padal na dvou místech, která nejsou skutečná výjimka.

## Co se nemění

- **`shared/db.py`** — connection, WAL, `tx`, migrace zůstávají. Repozitáře
  jsou vrstva *nad* ním, ne jeho náhrada.
- **Migrace** — zůstávají append-only v `db.py`. Repozitář schéma nedefinuje,
  jen ho čte/zapisuje.
- **MQTT RPC povrch** — endpointy se nemění, takže frontend ani MagicMirror
  nic nepoznají. Je to čistě vnitřní refaktor.
- **Tvar dat** — `store.load()` vrací stejný dict, `codegen.generate()` bere
  stejný vstup, `pages.js`/`modules.js` vypadají identicky.

## Postup (nejmenší riziko první)

Každý krok je samostatně commitovatelný a testy musí po každém projít
(dnes 158).

1. **`repositories/base.py` + `radar_config.py`** — 3 SQL, izolovaná tabulka,
   žádný cross-feature dopad. Ověří vzor `conn=None` na nejmenším případu.
2. **`repositories/profiles.py`** — sjednotí duplikovaný upsert, odstraní
   `DEFAULT_PROFILE` duplikát a **oba lazy importy z camery do scenes**. Tohle
   je největší výhra za nejméně práce.
3. **`camera_photos.py`** — dokončí camera feature (0 SQL).
4. **`scene_instances.py` + `scene_layout.py`** — největší kus; tady se zároveň
   vyřeší `config_json`. Testy `test_per_profile_instances.py` pokrývají právě
   tu nejrizikovější část (per-profile delete), takže regrese se pozná.
5. **`module_catalog.py` + `module_jobs.py`** — 18 SQL, ale přímočaré.
6. **Odstranit `install.py` → scenes import** — poslední cross-feature vazba.
7. **Test, který hlídá pravidlo** — grep-test v `features/`, že tam není SQL:

```python
def test_features_contain_no_sql():
    """SQL patří do repositories/. Tenhle test drží vrstvu, aby se za rok
    nevrátilo ad-hoc SELECT do feature kódu."""
    offenders = []
    for path in Path("features").rglob("*.py"):
        if path.name.startswith("test_"):
            continue
        if re.search(r"\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b",
                     path.read_text()):
            offenders.append(str(path))
    assert not offenders
```

Bez tohohle testu vrstva eroduje — je to to, co z návrhu dělá vynucené
pravidlo místo doporučení.

## Otevřené otázky

1. **`repositories/` vs `shared/repositories/`** — návrh volí první (datová
   vrstva není infrastruktura). Pokud chceš plochý `backend/`, druhá varianta
   je taky obhajitelná.
2. **Pojmenování** — `repositories/` (DDD termín) vs `data/` vs `stores/`.
   Pozor: `store` už znamená dvě jiné věci (scenes layout store, modules
   store), takže `stores/` by pletlo.
3. **`config_json`** — přestat plnit (doporučeno), nebo začít číst v `load()`?
4. **Rozsah teď** — celé (kroky 1-7), nebo jen kroky 1-2 jako pilot a zbytek
   až po ověření vzoru?
