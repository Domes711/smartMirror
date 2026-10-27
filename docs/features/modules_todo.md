# features/modules/ — what's left after the ai_modules split

`features/ai_modules/` is split out (see `ai_modules.md`). This feature now
owns only the module *store*: what is available, installing/uninstalling
community modules, install progress.

**§1 (constants/service split), §3 (seeding) and the §5 test are done** — see
"Done" below. §2 (wire-format cleanup in `catalog.py`) stays blocked on the
frontend rework; §4 was a documentation-only note and needs no further
action.

## Done

- **§1 split landed.** `constants.py` (topics + `NON_MODULE_DIRS`) →
  `service.py` (new orchestrator: `catalog_full`, `readme`, `install_start`,
  `install_status`, `uninstall`, plus the install-progress watcher thread,
  all publishing through a `set_publisher()` callback instead of importing
  MQTT directly — same shape as `ai_modules.service`) → `mqtt.py` (RPC
  dispatch only, `serve_all()`) / `http.py` (the two catalog-read routes) →
  `daemon.py` (entrypoint, `main()`, no logic). The old `api.py` (mixed
  transport + orchestration) is gone; the old entrypoint `service.py` was
  renamed to `daemon.py` in the same change that introduced the new
  `service.py`, so the name collision never existed on disk.
- **`modules.service` is now a template**, substituted by `setup.sh` via
  `sed` (`__USER__`/`__GROUP__`/`__BACKEND_DIR__`/`__PYTHON__`), same
  mechanism as `display.service`/`ai-modules.service`.
- **§3 seeding landed, then `seed.py` was deleted outright.** `setup.sh` no
  longer calls `seed.py` — `daemon.py`'s `main()` already calls
  `catalog.seed_builtins()` on every boot (idempotent, no network), so
  chaining the same seed from `setup.sh` was redundant. With that gone,
  `seed.py`'s only remaining job was `import_community()` (the ~1400-entry
  upstream catalog fetch) — decided that import path is not worth keeping
  either, so the whole file was removed. There is no community-catalog
  import any more; the catalog only ever holds the in-repo built-ins plus
  whatever gets installed by hand.
- **§5 test added**: `features/tests/test_transports.py` now has
  `test_modules_install_rpc_and_mqtt_publish_through_the_same_service`,
  generalizing `test_modules_rpc_and_http_agree_on_the_catalog` to the
  install/uninstall path. All three `modules`-related transport tests were
  also updated to import `mqtt.py`/`http.py`/`constants.py` instead of the
  removed `api.py`.

## Previous shape (superseded)

| File | Role before this split |
|---|---|
| `service.py` | Entrypoint: `main()` parsed args, seeded builtins, mounted `api.py`'s router, served static `/module-assets`. Renamed to `daemon.py`. |
| `api.py` | Both the MQTT dispatch *and* the HTTP routes, in one `mount(router)` — no separate `constants.py`/topics-only file; topics lived in `mqtt.py` but the serve/dispatch logic was here, mixed with the install-progress watcher thread. Deleted — split into `mqtt.py`/`http.py`/`service.py`. |
| `mqtt.py` | Topic constants only (`RPC_CATALOG`, `RPC_INSTALL`, …) — topics moved to `constants.py`; `mqtt.py` is now RPC dispatch only. |

## 1. Constants / service / entrypoint split — done, see "Done" above.

## 2. `catalog.py` is two jobs wearing one name

`catalog.py` is simultaneously:

a) **the store's read/write API** (`upsert`, `seed_builtins`, `placeable`,
   `by_type`, `full_catalog`, `lookup`, `mark_installed`, `remove`) — this
   is the orchestration `service.py` should own once split out per §1.
b) **a wire-format translation layer**: every function accepts/returns the
   old shape (`type`, `module`, `label`, `scope`, `remote_image`, `image`)
   and maps it onto `data/module_catalog.py`'s real columns (`module_name`,
   `label_cs`, `category`, …). `upsert()`'s docstring says this outright:
   *"`entry` uses the API shape … so callers do not have to know the column
   layout."*

(b) is `backend/README.md`'s "Where to pick up" item #1: *"Frontend still
speaks the old API shapes… Decided: compatibility is not maintained — the
FE is reworked after the backend."* That means this translation layer is
**temporary scaffolding**, not a permanent architecture layer — once the
frontend is updated to send/receive the real column names directly, this
whole shape-mapping half of `catalog.py` should be deleted, and whatever
remains of (a) moves into `service.py` directly calling
`data.module_catalog` with real field names.

**Action, in order:**
1. Finish the `constants`/`service` split with `catalog.py` kept as-is for
   now (it already works, don't block that refactor on the frontend).
2. Separately, once the frontend moves off `type`/`scope`/`remote_image`:
   delete the wire-shape mapping functions, inline `data.module_catalog`
   calls directly into the new `service.py`.

## 3. Seeding — done, see "Done" above. `seed.py` (and `import_community()`
with it) was deleted; there is no community-catalog import any more.

## 4. `install.py`'s `MODULE_NAME_RE` vs. `ai_modules`'s normalize-on-install

`ai_modules` dropped input-validation regexes in favour of normalizing the
name once, at `install()` time (`workspace.normalize_name()`) — see
`ai_modules.md`'s "Dropped" section. `features/modules/install.py` still
validates every module name against `MODULE_NAME_RE` (`^MMM-[A-Za-z0-9_.-]
{1,60}$`) before cloning or uninstalling.

**This is deliberately not the same situation** — `install.py`'s regex
guards a `git clone` destination path and an `rm -rf` target built from
catalog data (security boundary: a malformed/malicious catalog row must not
let `install()`/`uninstall()` write or delete outside
`MagicMirror/modules/`), not a new module's display name picked by a user.
**Keep `MODULE_NAME_RE` in `install.py` as-is** — this item is here only to
record that the two features validate module names differently on purpose,
so a future reader does not "fix" one to match the other.

## 5. Tests — done, see "Done" above.

## Remaining

Only §2 (wire-format cleanup in `catalog.py`) is still open, and it stays
blocked on the frontend rework (`backend/README.md` item #1) — do it once
the frontend moves off `type`/`scope`/`remote_image`. §4 needs no code
change, ever; it is a note for future readers.
