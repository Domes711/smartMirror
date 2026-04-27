# MMM-Package-Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-27-mmm-package-tracker-design.md`
**Goal:** Show inbound packages on the mirror, sourced from a dedicated HA todo list, enriched by AfterShip's universal API. Delivered packages auto-complete in HA so they vanish from the mirror and the iPhone list at the same time.

**Order of work:** AfterShip account → HA list → module skeleton → HA reader → AfterShip enricher → cache → frontend → auto-complete → wire into config.

**Pi commands run via SSH:** `ssh admin@10.0.0.249`

---

### Task 1: Create AfterShip account and obtain API key

**Files:** none (external setup)

- [ ] **Step 1:** Sign up at https://www.aftership.com/ (free tier — 100 shipments/month).
- [ ] **Step 2:** In the AfterShip dashboard → Settings → API Keys → create a new API key labelled `magicmirror-pi`.
- [ ] **Step 3:** Save the key in the user's password manager. It will be referenced by `aftershipApiKey` in `config.js`.
- [ ] **Step 4:** Sanity-check the key with curl:
  ```
  curl -s -H "aftership-api-key: <key>" \
    https://api.aftership.com/tracking/2024-04/couriers
  ```
  Should return a JSON list of couriers with HTTP 200.

---

### Task 2: Create the HA todo list

**Files:** none (HA-side configuration)

- [ ] **Step 1:** In Home Assistant → Settings → Devices & Services → search for the **Local To-do** integration → Add → name it `Balíky` → entity becomes `todo.balicky`.
- [ ] **Step 2:** Verify on the iPhone HA app the new list `Balíky` is visible and items can be added.
- [ ] **Step 3:** Add one test item from the iPhone:
  - `summary` = a real or test tracking number (e.g. `1Z999AA10123456784`)
  - `description` = `Amazon kabel`
- [ ] **Step 4:** Verify via HA REST API that the item is reachable:
  ```
  curl -s -X POST -H "Authorization: Bearer <ha_token>" \
       -H "Content-Type: application/json" \
       -d '{"entity_id": "todo.balicky"}' \
       "http://<ha>:8123/api/services/todo/get_items?return_response=true"
  ```
  Confirm `service_response.todo.balicky.items[].summary` matches.

---

### Task 3: Module skeleton

**Files:**
- Create: `MagicMirror/modules/MMM-Package-Tracker/MMM-Package-Tracker.js`
- Create: `MagicMirror/modules/MMM-Package-Tracker/MMM-Package-Tracker.css`
- Create: `MagicMirror/modules/MMM-Package-Tracker/node_helper.js`
- Create: `MagicMirror/modules/MMM-Package-Tracker/package.json`
- Create: `MagicMirror/modules/MMM-Package-Tracker/.gitignore` (excludes `cache.json`)
- Create: `MagicMirror/modules/MMM-Package-Tracker/README.md`

- [ ] **Step 1:** `package.json` with `name`, `version: "0.1.0"`, no runtime deps.
- [ ] **Step 2:** Frontend: `Module.register("MMM-Package-Tracker", { defaults: {…}, … })` mirroring the structure of MMM-HA-Reminders (`start`, `suspend/resume`, `getHeader`, `getStyles`, `socketNotificationReceived`, `getDom`).
- [ ] **Step 3:** Defaults match the spec's config block. `getStyles` returns `["MMM-Package-Tracker.css", "font-awesome.css"]`.
- [ ] **Step 4:** `node_helper.js` skeleton with `start`, `stop`, `socketNotificationReceived(MMPT_INIT)`, empty `_tick` placeholder.
- [ ] **Step 5:** Empty CSS file with `.mmpt`, `.mmpt-row`, `.mmpt-status` placeholder selectors.
- [ ] **Step 6:** Commit `feat(MMM-Package-Tracker): module skeleton`.

---

### Task 4: HA reader in node_helper

**Files:**
- Modify: `MagicMirror/modules/MMM-Package-Tracker/node_helper.js`

- [ ] **Step 1:** Implement `_fetchTodoItems()` calling `POST /api/services/todo/get_items?return_response=true` with body `{ entity_id: this.config.todoEntity }`. Reuse the response shape from MMM-HA-Reminders' `_fetchOne`.
- [ ] **Step 2:** Map the response to `[{ uid, summary, description, status }]` and filter to `status === "needs_action"`.
- [ ] **Step 3:** In `_tick`, call `_fetchTodoItems()` and `sendSocketNotification("MMPT_ITEMS", { items, generatedAt })` so the frontend can render bare tracking numbers even before AfterShip enrichment lands.
- [ ] **Step 4:** Defensive errors: missing `haUrl`/`haToken`/`todoEntity` → `MMPT_ERROR` with `"není nakonfigurováno"`. HTTP failure → `"chyba HA"`.
- [ ] **Step 5:** Manual test on Pi: restart MagicMirror, confirm the module shows the test tracking number from Task 2.
- [ ] **Step 6:** Commit `feat(MMM-Package-Tracker): poll HA todo list`.

---

### Task 5: AfterShip enrichment + cache

**Files:**
- Modify: `MagicMirror/modules/MMM-Package-Tracker/node_helper.js`

- [ ] **Step 1:** Implement on-disk cache helpers `_loadCache()` / `_saveCache()` reading/writing `cache.json` next to `node_helper.js`. Atomic write via `fs.writeFileSync` to `cache.json.tmp` + `fs.renameSync`. On boot, attempt to load; on parse error, log and start with `{}`.
- [ ] **Step 2:** Add `_aftershipFetch(method, path, body)` helper that sets the `aftership-api-key` header, returns parsed JSON, and throws on non-2xx (except for the documented "already exists" code 4022, which is treated as success).
- [ ] **Step 3:** Implement `_registerTracking(number)` → `POST /trackings` with `{ tracking: { tracking_number } }`. AfterShip auto-detects the courier; capture `slug` and `tracking_number` from the response. On 4022 (already exists), call `GET /trackings?keyword=<number>` to recover the slug.
- [ ] **Step 4:** Implement `_refreshTracking(slug, number)` → `GET /trackings/{slug}/{number}`. Return `{ slug, courierName, status, expectedDelivery, lastEvent, lastEventTime }` extracted from `data.tracking`.
- [ ] **Step 5:** In `_tick`, after fetching todo items: for each tracking number not in cache, call `_registerTracking`. Then for each in-cache, call `_refreshTracking`. Update cache.
- [ ] **Step 6:** Merge todo + cache into `enrichedItems` and emit `MMPT_ITEMS`.
- [ ] **Step 7:** Prune cache: drop entries whose `lastChecked` is older than `pruneAfterDays` AND whose tracking number is no longer in the HA list.
- [ ] **Step 8:** Wrap AfterShip calls in try/except — a single failure must not kill the poll cycle. Per-tracking-number errors are logged and skipped; the row falls back to its cached value.
- [ ] **Step 9:** Manual test on Pi: confirm the test tracking number gets a courier name and status after one poll.
- [ ] **Step 10:** Commit `feat(MMM-Package-Tracker): enrich tracking numbers via AfterShip with on-disk cache`.

---

### Task 6: Frontend rendering

**Files:**
- Modify: `MagicMirror/modules/MMM-Package-Tracker/MMM-Package-Tracker.js`
- Modify: `MagicMirror/modules/MMM-Package-Tracker/MMM-Package-Tracker.css`

- [ ] **Step 1:** Implement `_itemRow(item)` producing the two-line row described in the spec (label + status badge on line 1; courier + ETA-or-event on line 2).
- [ ] **Step 2:** `_statusLabel(status)` returns the cs label per the spec table; `_statusClass(status)` returns the css class for color.
- [ ] **Step 3:** `_formatEta(date)` reuses the `_formatDue` logic from MMM-HA-Reminders (today/tomorrow/weekday/`DD.MM.`).
- [ ] **Step 4:** Sort order in `getDom`: `OutForDelivery` → `InTransit`/`InfoReceived` → `AvailableForPickup` → `Exception`/`AttemptFail` → others. Within a bucket sort by `expectedDelivery` ascending.
- [ ] **Step 5:** CSS: subdued grey for default rows, slightly highlighted (white) for `OutForDelivery`, amber for warnings, dim for `mmpt-done`. Layout matches `mmhar-row` proportions.
- [ ] **Step 6:** Empty/error states match spec wording (`— žádné balíky`, `chyba HA`, `chyba AfterShip`, `není nakonfigurováno`).
- [ ] **Step 7:** Manual test on Pi: confirm visual rendering with the test package; take a screenshot for the README.
- [ ] **Step 8:** Commit `feat(MMM-Package-Tracker): frontend rendering with cs status labels`.

---

### Task 7: Auto-complete delivered packages in HA

**Files:**
- Modify: `MagicMirror/modules/MMM-Package-Tracker/node_helper.js`

- [ ] **Step 1:** Add `_completeTodoItem(uid)` → `POST /api/services/todo/update_item` with `{ entity_id, item: uid, status: "completed" }`.
- [ ] **Step 2:** In `_tick`, after enrichment: for each item with status `Delivered` and `config.autoCompleteOnDelivered === true`, call `_completeTodoItem(item.uid)` and remove its tracking number from cache. Mark a flag in memory so we don't double-call within the same poll.
- [ ] **Step 3:** Test end-to-end on Pi: change a known-delivered tracking number into the HA list, wait one poll cycle, confirm the iPhone HA app shows the item completed and the mirror row is gone.
- [ ] **Step 4:** Commit `feat(MMM-Package-Tracker): auto-complete delivered packages in HA`.

---

### Task 8: Wire into MagicMirror config

**Files:**
- Modify: `MagicMirror/config/config.js` (mirrored from Pi)

- [ ] **Step 1:** On the Pi, edit `~/MagicMirror/config/config.js` to add a new module entry:
  ```js
  {
      module: "MMM-Package-Tracker",
      position: "top_right",
      config: {
          header: "Balíky",
          haUrl: "http://<ha>:8123",
          haToken: "<ha_token>",
          todoEntity: "todo.balicky",
          aftershipApiKey: "<aftership_key>",
          refreshSec: 1800,
          maxItems: 6,
          autoCompleteOnDelivered: true,
          language: "cs"
      }
  }
  ```
- [ ] **Step 2:** If MMM-Profile is in use, add `id: "package_tracker"` to the entry and add it to the relevant page layouts in `pages.js`. Otherwise leave `position` as above.
- [ ] **Step 3:** `pm2 restart MagicMirror` and confirm the module renders with real data.
- [ ] **Step 4:** Mirror updated `config.js` (and `pages.js` if changed) into the repo, replacing tokens/keys with `_PLACEHOLDER` values.
- [ ] **Step 5:** Commit `chore: wire MMM-Package-Tracker into MagicMirror config`.

---

### Task 9: Documentation

**Files:**
- Modify: `MagicMirror/modules/MMM-Package-Tracker/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1:** README sections: Overview, HA setup (Local To-do integration + Long-Lived Token), AfterShip setup (key creation + free-tier note), Config options table, iPhone Shortcut example for adding a package by share-sheet (paste tracking number → adds to `todo.balicky`).
- [ ] **Step 2:** Add `MMM-Package-Tracker` row to the **Repository layout** table in `CLAUDE.md`, and link the spec/plan from the **Planned features** section (or a new **Completed features** section, depending on state).
- [ ] **Step 3:** Commit `docs(MMM-Package-Tracker): setup, config, iPhone Shortcut`.

---

### Task 10: Push branch

- [ ] **Step 1:** `git push -u origin claude/package-tracking-module-LVutK`.
- [ ] **Step 2:** Stop here — do **not** open a PR until the user explicitly asks.
