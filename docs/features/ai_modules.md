# features/ai_modules/ — the AI module builder, split out of modules/

This feature was `ai_builder.py` (+ `ai_prompts.py`, `ai_templates.py`)
inside `features/modules/`. It is now its own feature, `features/ai_modules/`
(`:8004`, unit `ai-modules`), following the same file-role pattern introduced
for `display/` (see `refactor_display_feature.md`): `constants.py` →
`driver`-equivalent (`agent.py`) → `service.py` (the one orchestrator) →
`mqtt.py` / `http.py` entrypoints, `daemon.py` ties it together.

`features/modules/` keeps the module *store* (catalog, install, uninstall,
install progress) — it no longer knows the AI builder exists.

## Why split

`modules/` originally merged the store and the AI builder into one unit
because both touch the module catalog. In practice they have unrelated
failure modes (a slow `npm install` vs. a long-running `claude` CLI
subprocess) and unrelated scaling (the store is stateless reads + one
background clone; the builder holds a whole chat conversation per module),
so the merge bought nothing and made both harder to reason about.

## Core model change: DB is the only source of truth

The old `ai_builder.py` read/wrote a `.module-chat.json` file (plus a
generated `CLAUDE.md`) inside each module's directory, and kept an in-memory
`_Session` (with a `prepared` flag and a `busy` lock) that did not survive a
restart. This feature replaces all of that:

- **`ai_module_sessions`** (one row per module name, `shared/db.py`
  `_m001_initial`) — `scope` (`'draft'` | `'installed'`), `description`,
  **`claude_session_id`** (the Claude CLI's own `--resume` conversation id),
  `created_at`. `UNIQUE(name)` — **one Claude conversation per module for its
  whole lifetime**, draft and installed share the same row and the same
  `claude_session_id`; editing an installed module just flips `scope` back
  to `'draft'` on the same row, nothing is lost.
- **`ai_module_messages`** — one row per chat message
  (`session_id`, `role`, `text`, `created_at`), CASCADE-deleted with its
  session.
- **`module_catalog.ai_module_session_id`** — nullable FK, `ON DELETE SET
  NULL`. Links a catalog row to the session that built/last edited it.
  `source = 'ai'` is a new catalog source alongside `custom` / `installed` /
  `community`.

The working copy on disk (`features/ai_modules/modules/<name>/`, gitignored,
deliberately inside the feature folder rather than `var/` — see
`shared/paths.py` `AI_MODULES_WORKSPACE_DIR`) is a side effect of editing,
never consulted as a source of truth. `list_drafts()`, `session_get()`,
"does this module have a pending edit" — all of it is one DB read. No
function in this feature does `os.path.isdir(...)` to decide whether
something exists.

`CLAUDE.md` is generated **once, at `install()`**, from the DB chat history
— it is human-readable documentation now, not the agent's memory (that is
`claude_session_id` + `--resume`). The old `load_claude_md`/"read it back for
context" step does not exist: the CLI remembers on its own.

## Two flows, one `install()`

**Flow A — new module from scratch:**
1. `draft_create(name, description)` — `templates.scaffold()` writes 4 files
   (`<name>.js`, `.css`, `node_helper.js`, `package.json` — no `demo.html`,
   no `README.md`, unlike the old 6-file scaffold) into a new working copy;
   a `draft` session is created.
2. `new_message(...)` any number of times — each one resumes the same
   `claude_session_id`.
3. `install(...)` — generates `CLAUDE.md` from history, normalizes the name
   (`workspace.normalize_name`: strips spaces/diacritics, ensures the
   `MMM-` prefix), copies the working copy into
   `MagicMirror/modules/<name>/`, upserts `module_catalog` with
   `source='ai'`, flips the session to `installed`, **deletes the working
   copy**. The module now lives in exactly one place.

**Flow B — editing an installed module (AI-built or community):**
1. `edit_open(name)` — copies the live module into a working copy (the
   original is untouched until install). A module with no session yet
   (first time a *community* module is opened here) gets its first agent
   turn as `prompts.ADOPT_PROMPT` (read the source, prepare `demo.html`,
   describe it in one sentence) — not a user message, so it is not stored
   with `role='user'`.
2., 3. — identical to Flow A's `new_message`/`install`. `install()`
   overwrites the live module and deletes the working copy again.

## Transport: MQTT only, one HTTP route

Every operation (`status`, `list`, `draft/create`, `edit/open`, `message`,
`session`, `install`) is MQTT-only under `smartmirror/ai_modules/*` — flat
topics, no `rpc` segment (`mqtt.py`'s `AiModulesMqtt.serve_all()`). There are
**no JSON HTTP twins** — the migration-shim pattern other features still use
does not apply here, this feature was built MQTT-first.

The one HTTP route, `GET /module-draft/<name>`, exists because MQTT cannot
carry a directory: it zips the whole working copy
(`workspace.zip_working_copy()`) and returns it as `application/zip`; the
frontend unpacks it client-side to build the `<iframe>` preview. No
per-file static mount (`/module-draft/<name>/<file>`) like the old
`service.py` had — one zip, one request.

The agent's live token stream is still pushed per-session, now on
`smartmirror/ai_modules/stream/<scope>/<name>` (flat `stream_topic()`
helper), same event shapes the old SSE carried (`{"type": "text"|"tool"|
"error"|"done", ...}`).

## File map

| File | Role |
|---|---|
| `constants.py` | MQTT topics only. No `MODEL`/`NAME_RE`/`STORE_SHOTS` — see below. |
| `daemon.py` | Entrypoint: starts the MQTT client + `AiModulesMqtt`, mounts `http.py`'s router, `serve()` blocks (that is what keeps the process alive — no explicit `while True`, see `refactor_display_feature.md`'s "daemon vs init" note). |
| `mqtt.py` | `AiModulesMqtt` — `serve_all()` dispatches every topic to `service.py`; publishes the agent stream via a callback `service.py` holds (`set_stream_publisher`), so `service.py` never imports an MQTT client directly. |
| `http.py` | The one zip route. |
| `service.py` | The only orchestrator. Every other file in this list is a plain worker `service.py` calls — none of them call each other. |
| `workspace.py` | Working-copy file I/O: `write_files`, `write_claude_md`, `copy_from_installed`, `copy_to_installed`, `delete_working_copy`, `normalize_name`, `zip_working_copy`, `path_for`. No DB, no decisions. |
| `agent.py` | Runs the `claude` CLI subprocess (`find_claude`, `run`), `make_claude_md`. Stateless — `service.py` always hands in whatever `claude_session_id` it read from the DB and gets a new one back to store. |
| `templates.py` | `scaffold()` + its four pieces (`module_js`, `module_css`, `node_helper_js`, `package_json`) as separate functions. Pure string generation. |
| `prompts.py` | Ported system prompts, `ADOPT_PROMPT` (CLAUDE.md-writing step removed — that only happens at `install()` now), `AUTH_HINT`. Language comes from `shared/sys_config.language()`, not a local `mirror_language()`. |
| `ai-modules.service` | systemd unit **template** (`__USER__`/`__GROUP__`/`__BACKEND_DIR__`/`__PYTHON__` placeholders), not a generated reference copy — same pattern as `display.service`. |
| `setup.sh` | `sed`-substitutes the template into `/etc/systemd/system/`, same mechanism as `display/setup.sh`. No `pip_install paho-mqtt` (installed once by the top-level `backend/setup.sh`). |

## Dropped from the old `ai_builder.py`

- **`prepared` flag / `_start_adopt` / separate `edit/prepare` + `adopt`
  RPCs** — `edit_open()` on a never-opened module now always runs the adopt
  turn inline; there is no "maybe adopt, maybe not" branch to guard.
- **Automatic adopt after a *community* module install** (`_watch_install`
  in `features/modules/api.py` used to trigger it) — deliberately not
  wired up. `modules/` and `ai_modules/` have no cross-feature call between
  them; adopting a freshly-installed community module only happens when the
  user opens it in the AI builder (`edit_open`).
- **`pm2 restart MagicMirror` after install / as its own RPC** — removed
  from `install()` and dropped as a standalone topic; restarting the mirror
  after a module change is being solved separately.
- **`demo.html` and `README.md` generation** — `scaffold()` writes 4 files,
  not 6. No Playwright screenshot step either (`STORE_SHOTS` and the
  landscape/portrait store-card thumbnails are gone).
- **`NAME_RE` input validation** — a module name is accepted as typed; only
  `workspace.normalize_name()`, run once at `install()`, turns it into a
  valid `MMM-` folder name.

## Still open

- `shared/sys_config.py` currently has just `language()` — a regex pull out
  of `config.js`, same approach `mirror_language()` used. No general
  "parse any config.js key" exists yet (`config.js` is JS, not JSON; the
  only path there is shelling out to `node`), deliberately deferred.
- Nothing publishes a "module installed" event the way `profile_changed`
  works for display — if another feature ever needs to react to an AI
  module going live, that is unbuilt.
