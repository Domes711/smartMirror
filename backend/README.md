# backend/

Python backend for the smart mirror. Five **feature folders**, each a fully
self-contained unit — code, MQTT topics, systemd unit file and its own
`setup.sh` — plus a `data/` access layer, a thin `shared/` layer and an edge
gateway.

**This is the only README in `backend/`.** The per-feature ones were deleted:
they drifted out of date and contradicted each other. Everything about the
backend is here.

```
backend/
├── gateway.py            edge router on :8000 (the one origin the app uses)
├── setup.sh              master installer — chains every feature's setup.sh
├── conftest.py           the `sandbox` fixture: throwaway DB + var dir per test
├── pytest.ini            pythonpath=., testpaths=., tools/ excluded
├── shared/               infrastructure only
│   ├── db.py             SQLite connection, WAL, migrations, tx()
│   ├── mqtt_client.py    paho wrapper: retry, re-subscribe, serve() = RPC
│   ├── systemctl.py      systemctl / pm2 / node / npm helpers
│   ├── http.py           minimal routed HTTP server (stdlib only)
│   ├── paths.py          every path, resolved lazily from the environment
│   ├── setup-lib.sh      the one "write a systemd unit" pattern
│   ├── sudoers.d/        the sudo rules the units need (ddcutil, systemctl)
│   └── tests/            test_http.py, test_mqtt_rpc.py
├── data/                 data access — ONE MODULE PER TABLE, the only SQL
│   ├── profiles.py       module_catalog.py  module_fields.py
│   ├── module_images.py  module_screenshots.py  module_tags.py
│   ├── module_install_jobs.py  camera_photos.py
│   ├── scene_instances.py  scene_windows.py
│   ├── scene_window_entries.py  scene_default_entries.py
│   ├── device_config.py  all six <device>_config tables
│   └── tests/            test_schema.py — the constraints the design relies on
├── tests/                test_gateway.py — the edge route table
├── var/                  gitignored runtime state (DB, dataset, assets, drafts)
└── features/
    ├── camera/           face recognition, arbitration, MJPEG, enrollment
    ├── radar/            LD2450 presence detection
    ├── display/          Dell U2515H over DDC/CI
    ├── scenes/           scene store + pages.js / modules.js codegen
    └── modules/          module store + AI module builder
```

## Ports

| Port | Who | What |
|---|---|---|
| 8000 | `mirror-gateway` | edge — the only port the frontend talks to |
| 8001 | `camera-supervisor` | stream, enrollment, mode, radar unit control |
| 8003 | `modules` | `/store/*`, `/module-assets/*`, `/module-installed/*` |
| 8004 | `ai-modules` | `/module-draft/*` (working-copy zip); everything else is MQTT-only |
| 8005 | `mic` | mic config, `/mic/recording` (test recording WAV) |
| 1883 / 9001 | mosquitto | MQTT (TCP for daemons, WebSocket for the app) |

The features run as separate units on separate ports deliberately: the camera
holds an exclusive hardware lock and the AI builder spawns long-lived agent
subprocesses, so a crash in either must not take the scene editor down.

## systemd units

| Unit | Entrypoint | Enabled |
|---|---|---|
| `mirror-gateway` | `gateway` | yes |
| `camera-supervisor` | `features.camera.daemon` | yes |
| `camera-recognition` | `features.camera.recognition_daemon` | **no** — the supervisor starts/stops it |
| `radar` | `features.radar.daemon` | yes |
| `display` | `features.display.daemon` | yes |
| `scenes` | `features.scenes.service` | yes (MQTT-only, no port) |
| `modules` | `features.modules.daemon` | yes |
| `mic` | `features.mic.daemon` | yes |
| `wyoming-openwakeword` | external (`rhasspy/wyoming-openwakeword`) | yes — holds no mic handle, stays up |
| `wyoming-satellite` | external (`rhasspy/wyoming-satellite`) | **no** — `features.mic.service` starts/stops it around a test recording |

Every unit runs `python3 -m <target>` with `WorkingDirectory=backend` and
`PYTHONPATH=backend`, so `shared.*`, `data.*` and `features.*` resolve
identically under systemd, in tests, and from a shell.

There are no `__init__.py` files except `data/`: `shared/` and `features/*`
are PEP 420 namespace packages, which `python3 -m`, relative imports and
pytest all handle on their own.

---

# Database

One SQLite file, `backend/var/smartmirror.db`, in WAL mode (several processes
read it concurrently — WAL lets readers proceed while one writer holds the
lock, instead of serialising everyone behind `BEGIN EXCLUSIVE`).

**The full schema, with the reasoning behind every column, is
`docs/db-schema-cs.md`** (Czech). What follows is the operational summary.

Each feature owns the tables prefixed with its name. `profiles` is the one
cross-cutting table — both `camera` (trained faces) and `scenes` (per-profile
layouts) reference it with FK cascades, so deleting a person removes their
scenes instead of leaving orphans.

**18 tables** (plus `schema_migrations`): `profiles`, scenes (4), module
catalog (6), `camera_photos`, and six `<device>_config`.

## Profiles

```
name        TEXT PK
is_default  INTEGER   1 = the profile shown when nobody is recognized
created_at  TEXT
```

Exactly one row carries `is_default = 1`, enforced by a **partial unique
index** (`idx_one_default`) — a plain `UNIQUE` would also forbid two
non-default profiles. Deleting that profile is refused in code
(`features/camera/profiles.py`), because the mirror would have nothing to fall
back to.

The default profile is a **normal profile**: it has its own instances, its own
time windows and its own fallback layout, so "what shows when, for an
unrecognized face" is configured exactly like anyone else's.

## Modules: three layers

```
module_catalog    what is available        (one row per module)
scene_instances   what is configured       (one row per module + profile)
scene_*_entries   where and when it shows
```

`module_catalog.id` is the identity everything FKs to; `module_name` (UNIQUE)
is the folder under `MagicMirror/modules/`. There is no separate `type`
column — it used to duplicate `module_name` on every row.

`source` records provenance:

| Value | Meaning |
|---|---|
| `custom` | files already in this repo (ours or AI-built) — **installed by definition**, installing clones nothing |
| `installed` | cloned from upstream onto this Pi |
| `community` | browse-only until installed — **the only source that clones** |

Installing a module configures nothing. Adding it to a scene is what creates
the instance, owned by the profile that added it. A second profile adding the
same module does not re-clone — it gets its own instance with its own values,
which is how mail has separate credentials per person. Uninstalling is
profile-blind: it deletes the clone, so it removes every profile's instance.

## Hardware config: defaults + per-profile overrides

Six tables (`radar_config`, `camera_config`, `monitor_config`,
`distance_config`, `mic_config`, `speaker_config`), all the same shape:

```
id | profile | key | value          value is JSON-encoded
```

Rows with `profile = 'default'` are the defaults (seeded by the migration); a
row naming a profile overrides that **one key** for that person. Resolution is
"read the defaults, overlay the profile", so a profile with no rows gets the
defaults untouched — "the user set nothing extra" needs no special case.

```python
device_config.resolve("monitor", "dominik")
# {'brightness_day': 80,      ← default row
#  'brightness_night': 5,     ← dominik's override
#  'dim_timeout_s': 30, …}
```

The sentinel is `'default'`, not `NULL`: **`UNIQUE` on a nullable column does
not constrain anything in SQLite** (every `NULL` counts as distinct), so
duplicate default rows would slip through and resolution would pick one at
random. `'default'` also means the FK to `profiles(name)` works directly,
since that profile really exists.

**The camera is the only device with no overrides.** It is what *determines*
the profile, so it cannot be configured per person — a per-profile
`recognition_tolerance` would require knowing the profile in order to
recognize it.

| Device | Keys seeded by the migration | Read by the code? |
|---|---|---|
| `camera` | `rotation` (180 — mounted upside down) | ✅ `supervisor.py` capture loop |
| | `resolution_width` / `resolution_height` | ✅ `Supervisor.__init__` |
| | `recognition_tolerance` | ✅ supervisor + `daemon.py` |
| | `recognition_timeout_s` | ✅ `daemon.py` |
| | `framerate` | ❌ **seeded but unused** |
| `monitor` | `dim_timeout_s` | ✅ the core, via `display/config` |
| | `brightness_day` / `brightness_night` | ❌ **seeded but unused** |
| | `sleep_timeout_s` | ❌ **seeded but unused** |
| | `ddc_bus` | ❌ **seeded but unused** (ddcutil autodetects) |
| `radar` | none — defaults live in `features/radar/config.py DEFAULTS`, written on first save | ✅ via `device_config` |
| `mic` | none — defaults live in `features/mic/config.py DEFAULTS`, written on first save | ✅ via `device_config` + `setup.sh`'s unit templating |
| `distance`, `speaker` | none yet — tables exist so the pattern is ready | — |

The ❌ rows are **not dead schema** — they are the next piece of work. The
values describe behaviour the code still hardcodes or has not implemented
(nothing applies brightness on a profile switch, nothing sleeps the monitor on
a timeout). See *Where to pick up*.

## Blobs stay files

`var/encoded_faces.pickle` (the face model) and
`var/module-assets/<module_name>/*.png` (store screenshots, referenced by
path). A blob in SQLite would bloat the file and complicate serving it over
HTTP for no gain.

## Debug on the Pi

```bash
sqlite3 ~/smartMirror/backend/var/smartmirror.db .tables
sqlite3 ~/smartMirror/backend/var/smartmirror.db 'select * from scene_windows'
sqlite3 ~/smartMirror/backend/var/smartmirror.db \
  'select profile, key, value from monitor_config'
```

---

# data/ — the data access layer

**One module per table, and the only place SQL appears.** Before this layer,
SQL was spread across six feature files (`scenes/store.py` had 19 queries,
`modules/catalog.py` 18, `camera/profiles.py` 10, plus `install.py`,
`radar/config.py`, `seed.py`); changing a column meant hunting for everyone
who touched it.

## Rules

1. **One file = one table**, named after it.
2. **SQL lives only here.** Verify:
   ```bash
   grep -rn "SELECT \|INSERT \|UPDATE .* SET \|DELETE FROM" --include="*.py" features/
   # must print nothing
   ```
3. **Return `dict` / `list[dict]`**, never `sqlite3.Row` — callers must not
   learn that SQLite is underneath.
4. **No business logic.** Validation, config derivation and MQTT stay in the
   feature. "The default profile cannot be deleted" is a *rule*, so it lives
   in `features/camera/profiles.py` and calls `data.profiles.is_default()`.
5. **Transactions belong to the caller.** These are single operations; pass
   `conn=` to join an open `with db.tx():` instead of opening a new one.
6. **`shared/db.py` stays** — connection, WAL, migrations, `tx`, `jload` /
   `jdump`. `data/` uses it, it does not replace it.

## `device_config.py` — the one deliberate exception

Six identically-shaped tables would mean six copies of the same code, so the
table is a parameter instead. **The table name goes into SQL** (it cannot be a
`?` placeholder), so `device` is whitelisted against `DEVICES` — without that,
a device name from an MQTT or HTTP payload would be SQL injection.

`clear_override()` refuses to touch a default row: deleting one would leave
the device with no value at all.

## Migrations, during development

**`_m001_initial` is edited in place.** The Pi is wiped and rebuilt when the
schema changes, so there are no data-preserving migrations and no
backward-compat shims:

```bash
# on the Pi
rm ~/smartMirror/backend/var/smartmirror.db*
cd ~/smartMirror && ./setup.sh      # re-seeds the catalog; scenes are re-created by hand
```

The append-only rule ("add the next `@migration`, never edit a released one")
starts applying once the DB holds state that cannot be re-created by hand.

---

# Transport: MQTT first

**Every JSON operation is an MQTT RPC endpoint.** `MqttClient.serve()` in
`shared/mqtt_client.py` implements a payload-carried response-topic pattern
(no MQTT 5 required — mosquitto speaks 3.1.1):

```
request  → <endpoint topic>      {"_rid": …, "_reply": …, <args>}
reply    → the "_reply" topic    {"_rid": …, "ok": true,  …result}
                                 {"_rid": …, "ok": false, "error": …,
                                  "status": 404|409|500}
```

`_rid` correlates concurrent requests on one reply topic; `status` preserves
the HTTP status callers used to branch on. Omit `_reply` for a
fire-and-forget command. Handlers run on their own thread, so a slow one
cannot stall the client's other subscriptions.

Each feature declares its endpoints as `RPC_*` in its own `mqtt.py`.

State is **pushed retained** rather than polled: `camera/{mode,state,profiles}`,
`radar/{status,config}`, `display/{state,config}`,
`modules/install/progress/<type>`. The AI agent's token stream is
`smartmirror/ai_modules/stream/<scope>/<name>` — flat, no `rpc` segment, see
`features/ai_modules/constants.py`.

## What stays HTTP, and why

Only payload shapes pub/sub cannot carry:

- **`/stream.mjpg`** — binary multipart, unbounded.
- **`/photo`**, **`/module-assets/*`**, **`/module-installed/*`** — binary
  files / a live module's own static tree (`modules`, `:8003`).
- **`/module-draft/*`** — the AI builder's working-copy zip, unpacked
  client-side for the preview `<iframe>` (`ai_modules`, `:8004`).
- **`/store/catalog`** — the whole module store (~1400 modules after the
  MMM-store import, ~1.5 MB) as one page-load read; too big for one MQTT
  reply. The app always loads it over HTTP (`modules`, `:8003`).

`/api/modules/*` (chat, chat/stream SSE, draft/session CRUD) is **not** on
this list any more — that was the AI builder's pre-MQTT HTTP surface, and it
does not exist on the backend today (`ai_modules` is MQTT-only, see
`docs/features/ai_modules.md`). The frontend still calls those paths; that
gap is tracked, not routed around — `gateway.py` deliberately 404s them
instead of relaying to a port that would answer something unrelated.

Every other route on the gateway is a **temporary JSON twin** of an RPC
endpoint, calling the same handler, kept only while the frontend migrates.
`features/tests/test_transports.py` asserts the two cannot drift. When the app
is done, delete the twins and the gateway keeps just the list above.

Scenes has **no HTTP at all**. Talk to it on the bus:

```bash
mosquitto_pub -h 127.0.0.1 -t smartmirror/scenes/rpc/layout/get \
  -m '{"_reply":"cli/out"}' & mosquitto_sub -h 127.0.0.1 -t cli/out -C 1
```

---

# features/camera/

Face recognition plus camera arbitration. **Two entrypoints, not one**,
because the camera is an exclusive device:

| Unit | Entrypoint | Role |
|---|---|---|
| `camera-supervisor` (`:8001`) | `daemon.py` → `supervisor.py` | owns the camera, serves MJPEG + enrollment, **starts/stops the recognition unit** |
| `camera-recognition` (disabled) | `recognition_daemon.py` | production face recognition; the supervisor controls it |

Never `systemctl enable camera-recognition` — the supervisor would fight it
for the device.

Now follows the same `constants.py` / `service.py` / `mqtt.py` / `http.py` /
`daemon.py` split as `display/`, `ai_modules/`, `modules/` and `mic/`:

| File | Role |
|---|---|
| `constants.py` | MQTT topics only (was `mqtt.py`) |
| `supervisor.py` | the camera + arbitration layer: mode machine, capture loop, JPEG encode. This is the feature's HW-specific business logic, not a transport file — it predates and sits alongside `service.py`, same way `driver.py` does for `display/` |
| `profiles.py` | people + training photos |
| `enrollment.py` | capture a training photo from the live stream (needs the supervisor's camera lock + last clean frame) |
| `gestures.py` | pure finger-counting function |
| `encode_faces.py` | CLI trainer, invoked as a subprocess by `profiles.py` |
| `service.py` | the one orchestrator — thin delegation to the live `Supervisor`/`profiles.py`/`enrollment.py`, plus the radar-unit-control glue (lives here because the supervisor process holds the systemctl sudoers rights) and the boot-time retained-topic primer |
| `mqtt.py` | RPC dispatch (`serve_all()`), calls `service.py` 1:1 |
| `http.py` | the two binary routes (`/stream.mjpg`, `/photo`) **plus** the JSON migration shim, both calling `service.py` 1:1 |
| `daemon.py` | entrypoint for `camera-supervisor`: `main()` wires `service.mount(sup)` → `mqtt.serve_all()` → `http.mount()` → `serve()` |
| `recognition_daemon.py` | entrypoint for `camera-recognition` (was `daemon.py`): `FaceRecoDaemon` + `main()` — no transport split, it only subscribes, it does not serve RPC/HTTP |
| `tools/` | hand-run probes, **not collected by pytest** |

## Modes

| Mode | What happens |
|---|---|
| `face_detect` (default) | supervisor releases the camera, starts the recognition daemon |
| `test_face` | stops the daemon, opens the camera here, streams with a face overlay |
| `test_gesture` | same, with a gesture overlay |
| `learn` | like `test_face` but keeps a clean frame for enrollment |

Mode is persisted, so a reboot restores it. Default is `face_detect` so the
mirror behaves normally after a restart.

## Recognition flow

`recognition_daemon.py` subscribes to `smartmirror/radar/presence`. On
`present` it scans for up to `recognition_timeout_s` against
`var/encoded_faces.pickle` and publishes `{"user": "<name>"}` or
`{"user": null}` on `smartmirror/camera/recognition`. **Any failure also
publishes `null`**, so the mirror never gets stuck in `scanning`.

## Config from the DB

`rotation` (180 — the camera is mounted upside down), resolution, framerate,
scan timeout and tolerance all come from `camera_config`. CLI flags still
override, so a one-off run with a different tolerance needs no DB write. If
the DB is unreachable the code falls back to its constants — the camera must
still serve a stream.

## HTTP (`:8001`, via the gateway)

`/healthz` · `/mode` (GET/POST) · `/resolution` · `/dataset` (GET/DELETE) ·
`/capture` · `/encode` · `/profiles` (GET/DELETE) · `/radar` (GET/POST) ·
`/stream.mjpg` · `/photo`

The radar routes are here because the supervisor holds the systemctl rights —
a stopped radar daemon cannot start itself.

---

# features/radar/

HLK-LD2450 presence detection on UART `/dev/ttyAMA0` @ 256000 baud.
Unit: `radar`.

Reads frames, filters targets to a rectangular zone
(`abs(x) ≤ 400mm AND 0 < y ≤ 1500mm`), requires **3 consecutive in-zone
frames** before declaring `present` (one stray reflection should not wake the
mirror), pulses **GPIO17** to wake the display, and publishes:

| Topic | Payload |
|---|---|
| `smartmirror/radar/presence` | `present` / `absent` |
| `smartmirror/radar/targets` | `{targets, present, zone}` at ~10 Hz |
| `smartmirror/radar/config` | current config (retained) |
| `smartmirror/radar/status` | `{active, available}` (retained) |
| `smartmirror/radar/control` | **in:** calibration commands |

Calibration lives in `radar_config` through `data.device_config`, so it
supports per-profile overrides like the other devices. The **zone** should not
be overridden per profile (it is a property of the room); sensitivity and wake
delay are the sensible ones.

`serial` and `RPi.GPIO` are **lazily imported**, which is why the test suite
runs on a laptop.

```bash
sudo systemctl stop radar        # release the UART first
cd backend && python3 features/radar/viewer.py --simulate
```

---

# features/display/

Dell U2515H over DDC/CI (`ddcutil`), no GPIO. Unit: `display`.

Reactive: it executes MQTT commands and publishes state. Controls are
`smartmirror/display/control/<name>` with a plain (non-JSON) payload —
`power` (`on`/`standby`), `brightness` (0–100), `contrast`, `rgb`, `preset`,
`mode`, `e2`, `get_state`.

It also publishes **`smartmirror/display/config`** (retained): the resolved
`monitor_config` for the active profile. The core owns the dim/sleep timers
but has **no database driver**, so the backend pushes the values instead of
the core polling them. `…/control/profile` (payload: a profile name) makes the
daemon re-resolve and re-publish with that person's overrides.

The monitor is initialised to Standard mode on startup: Dell monitors with
dynamic contrast enabled **block manual brightness changes**.

```bash
mosquitto_pub -h 127.0.0.1 -t smartmirror/display/control/power -m 'on'
mosquitto_pub -h 127.0.0.1 -t smartmirror/display/control/brightness -m '50'
```

---

# features/scenes/

The scene store plus the codegen that writes the two files MagicMirror reads.
**MQTT-only: no HTTP, no port.** Unit: `scenes`.

| Term | Meaning |
|---|---|
| **instance** | a configured module (module + field values) owned by one profile |
| **window** | a named time range during which a layout applies |
| **default** | the profile's fallback layout, when no window is active ("Výchozí") |

## Wire format vs. database

The document the app and codegen speak uses **`type` = the module name**:

```json
{"instances": [{"id": "mail-dom", "type": "MMM-Mail", "profile": "dominik",
                "values": {…}, "placement": "region"}],
 "defaults":  {"default": [{"id": "clock", "position": "top_left"}]},
 "windows":   {"dominik": {"rano": {"from": "0 6 * * *", "to": "0 9 * * *",
                                    "label": "Ráno", "layout": […]}}}}
```

In the DB an instance references `module_catalog.id`. **`store.py` translates
between the two**, so nothing above it (API, codegen, frontend) needs to know
about catalog ids — which is why moving to `module_id` did not change the app.

## `values` vs. the generated config

`values_json` holds exactly what the user typed. What MagicMirror receives is
**derived on every generate** by `codegen.module_config()`:

```
values:  {"lat": 49.195, "lon": 16.608, "apiKey": "…"}
    ↓
config:  {"weatherProvider": "openmeteo", "type": "current", "lat": …}
```

Never cached. The old `config_json` column tried to and was removed: a cache
means fixing a mapping bug leaves existing instances on the broken shape until
the user re-saves them.

## `placement`

| Value | What happens |
|---|---|
| `region` (default) | DOM built into hidden `#mm-hot-staging`; `projectLayout()` moves it into the region the active layout names, hides it when omitted |
| `overlay` | Skipped in **both** places — not staged, and never moved or hidden. The module renders its own popup. |

`overlay` exists for `alert`: in a region it would be hidden (no layout names
it) and notifications would never show. It is a general contract, not an
`alert` hack — any module owning its own DOM needs it.

**It is not `position`.** `placement` says *whether* something is positioned;
*where* is `pages.js` alone, per `(profile, time window)`.

## Generated files

Plain JS the core `require()`s — which is how SQLite can own the data without
the core needing a DB driver.

- **`config/modules.js`** — one entry per instance: `id`, `module`,
  `placement`, `config`. **No `position`.** `config.js`'s `modules: []` is
  ignored.
- **`config/pages.js`** — `defaults` (`{<profile>: layout}`) plus
  `<profile>.<window>` with 5-field cron `from`/`to`. Active window = the one
  whose `from` fired most recently **and** more recently than its `to`; latest
  `from` wins on ties. Else `defaults[profile]`.

## MQTT

`rpc/layout/{get,put,apply}` · `rpc/modules/get` · `scenes/applied` (out) ·
`profile/preview` (out) · `core/hot-load` → `…/result` (load a module into the
running core with no pm2 restart)

---

# features/modules/

The module store (`:8003`, unit `modules`). The AI module builder is a
separate feature now — `features/ai_modules/`, `:8004`, unit `ai-modules`.

| File | What |
|---|---|
| `constants.py` | MQTT topics + `NON_MODULE_DIRS`. No logic. |
| `catalog.py` | what is available; `BUILTIN` is the in-repo list, written to the DB by `seed_builtins()` |
| `install.py` | clone + `npm install` on a background thread, progress in `module_install_jobs` |
| `service.py` | the one orchestrator — `catalog_full`, `readme`, `install_start`, `install_status`, `uninstall` — calling `catalog.py` and `install.py` |
| `mqtt.py` | RPC dispatch (`serve_all()`), calls `service.py` 1:1 |
| `http.py` | the two catalog-read routes (`/store/catalog`, `/store/readme`), calls `service.py` 1:1 |
| `daemon.py` | entrypoint: `main()` seeds builtins, mounts `mqtt.py` + `http.py`, no logic |

`/store/*` is the whole HTTP surface — install/uninstall/progress are
MQTT-only now.

`BUILTIN` includes **`alert`**, which is placed as an `overlay` instance. It
was missing before instances had a real FK; without a catalog row the overlay
instance is silently dropped and app notifications stop arriving.

## Seeding

`daemon.py`'s `main()` calls `catalog.seed_builtins()` on every boot
(idempotent, no network) — the in-repo built-ins must exist for the mirror to
function at all. Nothing is fetched at request time — the store screen reads
SQLite.

The **community catalog** is a one-time import by `store_import.py`, run by
hand via the repo-root `./import-store.sh` (arguments pass through) — not by
`setup.sh`/`deploy.sh`:

1. clone/pull github.com/Domes711/MMM-store into `var/mmm-store`
   (`--src DIR` uses an existing checkout; `MMM_STORE_REPO` /
   `MMM_STORE_BRANCH` override the remote);
2. fetch modules.magicmirror.builders' `modules.json` for what the store
   lacks — repo URL (needed to install), maintainer, stars, category
   (`--no-upstream` skips it; an earlier import's values are kept);
3. per `modules/<name>/mm-store.json`: `name`/`description` →
   `module_catalog` label/description cs+en, `wizard` → `module_fields`
   (label cs/en, required, type, help, options, `default` as placeholder),
   `tags` → `module_tags`, `screenshots` → copied to
   `var/module-assets/<name>/` + `module_screenshots`.

`custom`/`ai` rows are never touched, `installed` rows keep their source,
and `community` rows no longer in the store are deleted (`--keep-stale` to
keep them). `scope` (`global`/`per-user`) has no column yet and is not
stored.

---

# features/mic/

The USB mic's config + test recording (`:8005`, unit `mic`). This feature
does **not** implement a voice assistant, wake-word detection, or any audio
pipeline of its own — the mic is a **Wyoming satellite**
(`rhasspy/wyoming-satellite` + `rhasspy/wyoming-openwakeword`, two external
projects, cloned and run as their own systemd units by `setup.sh`) that
streams audio straight to Home Assistant's Assist pipeline. `wyoming-satellite`
is upstream-deprecated (superseded by Linux Voice Assistant / ESPHome) but
still maintained enough to run; kept because it is the documented path for a
plain USB mic today.

| File | What |
|---|---|
| `constants.py` | MQTT topics, the two Wyoming unit names, the ALSA mixer control name |
| `config.py` | `mic_config` wrapper — `device`, `satellite_name`, `wake_word`, `input_gain`, same resolve-defaults-then-overlay shape as `features/radar/config.py` |
| `service.py` | the one orchestrator — config get/set (+ `amixer` for `input_gain`, satellite unit regeneration for `device`/`satellite_name`/`wake_word`), satellite service status/set, `test_recording()` |
| `mqtt.py` | RPC dispatch (`serve_all()`), calls `service.py` 1:1 |
| `http.py` | the one binary route: `/mic/recording` (last test recording's WAV bytes) |
| `daemon.py` | entrypoint: `main()`, no logic |
| `apply-satellite-unit.sh` | root-only helper, invoked via sudoers — regenerates `wyoming-satellite.service` from the template + restarts it |

## Why no HW-arbitration supervisor module

The camera has `supervisor.py` because it holds a **persistent** capture
loop + mode machine shared by several consumers (face-reco daemon, test
streams, enrollment). The mic has none of that: `wyoming-satellite` holds the
ALSA device continuously via its own `--mic-command` subprocess, and the only
thing this feature ever needs to do is release it for a one-off test
recording. That is three sequential steps — stop the unit, run `arecord`,
start the unit again — not a mode machine, so it lives as one function,
`service.test_recording()`, with no dedicated arbitration file.

## Test recording

`test_recording(seconds)` (max `MAX_TEST_SECONDS` = 30): stops
`wyoming-satellite` if it is running, waits `SATELLITE_STOP_WAIT_S` for
`arecord` to release the device, records into
`var/mic-recordings/last.wav` via a plain `arecord -D <device> -d <seconds>
-f cd <dest>` subprocess, then restarts the satellite — in a `finally`, so a
failed recording still hands the mic back. Overwrites the previous
recording; this is a diagnostic tool, not a history. `GET /mic/recording`
serves the file (404 before the first recording exists).

## Config changes reach the live satellite

`wyoming-satellite` has no config-reload RPC — `device`, `satellite_name`
and `wake_word` are baked into its `ExecStart` command line at the time the
unit file is written. So that an MQTT `config/set` actually takes effect
instead of only updating `mic_config` until someone reruns `setup.sh`,
`service.config_set()` calls `_apply_satellite_unit()` whenever any of those
three keys changes: it shells out to `apply-satellite-unit.sh` (via
`shared.systemctl.run_privileged_script`, `sudo -n <exact path> <device>
<satellite_name> <wake_word>`), which re-renders `wyoming-satellite.service`
from the same template `setup.sh` used, `daemon-reload`s, and restarts the
unit **only if it was already running** (a stopped/mid-test-recording
satellite stays stopped). `input_gain` does not touch the unit — it is a
live `amixer` call, not an `ExecStart` field.

The sudoers grant (`shared/sudoers.d/smartmirror`) is scoped to this one
script's **exact path**, not a general `tee`/`daemon-reload`/`restart`
allowance — the mic daemon runs as the unprivileged `admin` user and cannot
write `/etc/systemd/system/` or reload systemd on its own, so the script
itself (fixed arguments: three plain strings, no shell injection surface) is
the entire scope of what root action a config write can trigger. A failure
here (sudoers not installed yet, satellite never set up) is logged and
swallowed — a config write must still succeed and land in the DB even if the
live unit cannot be touched.

## Satellite setup (`setup.sh`)

Installs `alsa-utils` + `libopenblas-dev` (the latter per the upstream 2-mic
tutorial, needed for local wake-word), clones `wyoming-satellite` and
`wyoming-openwakeword` under `$HOME` (sibling dirs, matching upstream's own
convention — not under `backend/`, since these are not this repo's code),
runs each project's own `script/setup` (creates its `.venv`, `pip install -e
.`), then installs both as systemd units from the template `.service` files
in this folder — `ExecStart=<repo>/script/run ...` directly, no manual venv
activation (`script/run` finds `.venv` itself). `wyoming-satellite` is
installed **disabled**: `features.mic.service` starts/stops it, the same
shape as `camera-recognition` being arbitrated by the camera supervisor.
This is also where `install_sudoers` runs, so `apply-satellite-unit.sh` has
its grant before anything ever calls it.

There is no Home Assistant / "server" flag on either side — HA discovers the
satellite via zeroconf on its own `--uri` (`tcp://<pi-ip>:10700`), or it is
added manually by IP in HA's UI (Settings → Devices → Wyoming Protocol). Do
not look for a `--server-uri`-style flag; it does not exist in either
project.

---

# Tests

```bash
cd backend
python3 -m pytest                        # 292 tests, hardware-free
python3 -m pytest data/tests             # the schema constraints
python3 -m pytest features/scenes/tests  # one feature
python3 -m pytest -k cascade             # one behaviour
```

Tests live in a **`tests/` dir next to the code they cover**: `data/tests/`,
`features/<name>/tests/`, `shared/tests/`, and `tests/` for the gateway.

Everything hardware-bound (picamera2, serial, GPIO) is **lazily imported**, so
the suite runs on a laptop. `conftest.py` gives each test a throwaway DB, var
dir and fake MagicMirror tree via the `sandbox` fixture — `paths.py` resolves
locations lazily, so setting env vars is enough and no module needs reloading.

`features/*/tools/test_*.py` are **hardware probe scripts** run by hand on the
Pi (they read the serial port), not tests. `norecursedirs` in `pytest.ini`
excludes them.

| Suite | Tests | Pins |
|---|---|---|
| `data/tests/test_schema.py` | 32 | the constraints the design relies on — one `is_default` profile, `module_name` unique, no instance of a missing module, one instance per `(module, profile)`, the full delete cascade, `upsert` keeping `installed_at`, unknown `device` refused not interpolated |
| `features/tests/test_device_config_wiring.py` | 13 | the hardware tables are **actually read** — otherwise they would be decoration |
| `features/tests/test_transports.py` | 18 | the HTTP and MQTT twins of each endpoint cannot drift |
| `features/scenes/tests/` | 37 | per-profile instances, overlay placement, partial saves |
| `features/radar/tests/` | 31 | frame parsing, zone filtering, config round-trip |
| `features/modules/tests/` | 27 | catalog upsert, install flow, cascade on remove |
| `features/camera/tests/` | 24 | mode transitions, profiles, photo reconcile |
| `shared/tests/` | 21 | the RPC contract against a fake broker, HTTP routing |
| `tests/test_gateway.py` | 28 | the edge route table; scenes has no route |

231 total.

---

# Where to pick up

Done, as of 2026-10-25 (see `REFACTOR.md`):

- schema rewritten (`is_default`, `module_id` FK, `category`, `module_images`,
  six `<device>_config` tables)
- `data/` layer extracted; **no SQL remains outside it**
- hardware config wired into the code it replaced — **partially**: camera
  rotation / resolution / tolerance, recognition timeout, radar config, and
  the monitor's `dim_timeout_s` reaching the core over MQTT. Five seeded keys
  are **not read by anything yet** (see the ❌ rows above)
- tests moved into `tests/` dirs; `pytest.ini` now collects **everything**
  (`data/tests` and `tests/test_gateway.py` were silently skipped before)

Open, roughly in order:

1. **Frontend still speaks the old API shapes.** The backend keeps `type` as
   the module name on the wire, so most of it works, but the app sends
   `scope`/`remote_image` where the DB now has `category`/`module_images`, and
   reads `builtin` where profiles now report `is_default`. Decided:
   compatibility is **not** maintained — the FE is reworked after the backend.
2. **Five seeded config keys are not read by any code.** The tables and the
   override machinery work; the behaviour behind these values does not exist
   yet:
   - `monitor.brightness_day` / `brightness_night` — nothing applies a
     brightness when the profile changes. The display daemon can already
     `setvcp` brightness on command, and `publish_config` knows the active
     profile, so this is "call the setter after resolving".
   - `monitor.sleep_timeout_s` — the core dims (`dim_timeout_s`) and then goes
     to `asleep`, but nothing powers the monitor off on a second, longer
     timeout.
   - `monitor.ddc_bus` — `ddcutil` is invoked without `--bus`, relying on
     autodetection. Only needed if autodetect ever picks the wrong display.
   - `camera.framerate` — the picamera2 config does not set a frame rate.
3. **`distance_config`, `speaker_config` are empty.** Tables and the override
   pattern exist; add keys when the hardware arrives. (`mic_config` is no
   longer in this bucket — `features/mic/config.py` seeds it the same way
   `features/radar/config.py` does.)
4. **Delete the HTTP twins** once the app is fully on MQTT, shrinking the
   gateway to the binary/streaming routes listed above.
5. **`DEFAULT_TOLERANCE` is inconsistent in code** — the supervisor says
   `0.6`, the daemon and the migration say `0.5`. Both now read
   `camera_config`, so `0.5` wins in practice. If the supervisor's `0.6` was
   deliberate, it needs its own key.
