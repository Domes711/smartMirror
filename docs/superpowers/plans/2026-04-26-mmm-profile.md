# MMM-Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-26-mmm-profile-design.md`
**Goal:** Replace continuous face-reco + standalone radar/display with one event-driven module that decides what's on the mirror based on (presence, recognized user, time-of-day cron).

**Order of work:** Pi-side first (so events can flow), then MagicMirror module, then config wiring, then deletion of v1 pieces.

**All Pi commands run via SSH:** `ssh admin@10.0.0.249`

---

### Task 1: Mark v1 specs/plans as superseded

**Files:**
- Modify: `docs/superpowers/specs/2026-04-14-magicmirror-face-recognition-design.md`
- Modify: `docs/superpowers/plans/2026-04-14-magicmirror-face-recognition.md`
- Modify: `docs/superpowers/specs/2026-04-14-ld2450-presence-detection-design.md`
- Modify: `docs/superpowers/plans/2026-04-14-ld2450-presence-detection.md`

- [ ] **Step 1:** Add a banner at the top of each file:
  ```markdown
  > **SUPERSEDED** by [MMM-Profile design](../specs/2026-04-26-mmm-profile-design.md)
  > on 2026-04-26. The continuous face recognition is replaced by on-demand
  > face_reco_once.py triggered by the LD2450 daemon; visibility and layout
  > are managed by the new MMM-Profile module. Kept for historical context.
  ```
- [ ] **Step 2:** Commit `docs: mark v1 face-reco / ld2450 docs as superseded`.

---

### Task 2: Write `face_reco_once.py`

**Files:**
- Create: `ld2450/face_reco_once.py` (in repo, deployed to `~/ld2450/` on Pi)

- [ ] **Step 1:** Implement single-shot capture + recognition. Inputs:
  - `--encodings` (default `~/MagicMirror/modules/MMM-Face-Reco-DNN/encoded_faces.pickle`)
  - `--endpoint` (default `http://127.0.0.1:8080/mmm-profile/event`)
  - `--timeout-sec` (default 3, max time we wait for a face)
  - `--tolerance` (default 0.6, face_recognition.compare_faces tolerance)
- [ ] **Step 2:** Use `picamera2` to grab one frame (BGR), convert to RGB.
- [ ] **Step 3:** Run `face_recognition.face_locations(frame, model="hog")` then
      `face_encodings`. If empty → POST `{ event: "user_unknown" }` and exit 0.
- [ ] **Step 4:** For each detected encoding, call `compare_faces` against the
      pickle. First match wins. POST `{ event: "user_recognized", user: "<name>" }`.
- [ ] **Step 5:** On any exception, log + POST `user_unknown`, never crash silently.
- [ ] **Step 6:** Verify locally syntactically (`python3 -m py_compile face_reco_once.py`).
- [ ] **Step 7:** Commit `feat(ld2450): single-shot face_reco_once.py for on-demand recognition`.

---

### Task 3: Extend `ld2450_daemon.py` with HTTP + face-reco trigger

**Files:**
- Modify: `ld2450/ld2450_daemon.py`

- [ ] **Step 1:** Add module-level `MM_ENDPOINT` constant + a thin `_post_event(payload)` helper using `urllib.request` (no extra deps needed).
- [ ] **Step 2:** In the daemon's main loop, when `PresenceTracker.update()` returns
      `'PRESENT'`:
  - Call existing relay-pulse (display ON)
  - `_post_event({"event": "presence_on"})`
  - `subprocess.Popen(["python3", "/home/admin/ld2450/face_reco_once.py"])` and forget
- [ ] **Step 3:** When tracker returns `'ABSENT'`:
  - Call relay-pulse (display OFF)
  - `_post_event({"event": "presence_off"})`
- [ ] **Step 4:** Wrap each POST in try/except — never let an HTTP failure stop the daemon.
- [ ] **Step 5:** Re-run the existing test suite (`pytest test_ld2450.py -v`) to confirm parser/tracker logic unchanged. Tests should still all pass.
- [ ] **Step 6:** Commit `feat(ld2450): post presence events to MM and trigger face_reco_once`.

---

### Task 4: Create `MMM-Profile` module skeleton

**Files:**
- Create: `MagicMirror/modules/MMM-Profile/MMM-Profile.js`
- Create: `MagicMirror/modules/MMM-Profile/MMM-Profile.css`
- Create: `MagicMirror/modules/MMM-Profile/node_helper.js`
- Create: `MagicMirror/modules/MMM-Profile/package.json`
- Create: `MagicMirror/modules/MMM-Profile/README.md`

- [ ] **Step 1:** `package.json` with `cron-parser` dep.
- [ ] **Step 2:** `node_helper.js`:
  - On `MMP_INIT`, start an HTTP server on port `mmm-profile/event` (use the
    same port MM is on, MM exposes Express; mount a sub-route).
  - Receive POST → forward to frontend via `sendSocketNotification("MMP_EVENT", body)`.
- [ ] **Step 3:** `MMM-Profile.js` skeleton:
  - State machine fields: `state`, `currentUser`, `dimTimer`.
  - `socketNotificationReceived("MMP_EVENT")` → drive transitions.
  - `getDom()` returns the indicator UI placeholder.
  - `getStyles()` returns `["MMM-Profile.css", "font-awesome.css"]`.
- [ ] **Step 4:** `MMM-Profile.css` — copy Face ID animation + avatar styles from
      MMM-FaceRecoIndicator/MMM-FaceRecoIndicator.css. Adjust class names.
- [ ] **Step 5:** Verify `node --check` on both .js files.
- [ ] **Step 6:** Commit `feat(MMM-Profile): skeleton with HTTP listener and indicator UI`.

---

### Task 5: Implement state machine + indicator rendering

**Files:**
- Modify: `MagicMirror/modules/MMM-Profile/MMM-Profile.js`

- [ ] **Step 1:** Implement transitions exactly as in spec:
      `asleep → awake_scanning → awake_user → awake_dimming → asleep`
      with re-entry from dimming on presence_on (no re-recognize).
- [ ] **Step 2:** Render indicator per state:
  - `asleep` — empty (or hidden)
  - `awake_scanning` — Face ID rotating dots
  - `awake_user` (known) — round avatar with initial + name
  - `awake_user` (default/unknown) — `?` badge with "Default" / "Unknown" label
  - `awake_dimming` — same as `awake_user` (visually unchanged per spec)
- [ ] **Step 3:** Verify by mocking notifications via `MM.getModules()` in browser
      DevTools (no Pi needed yet).
- [ ] **Step 4:** Commit `feat(MMM-Profile): state machine + indicator rendering`.

---

### Task 6: Implement page resolution + DOM remap

**Files:**
- Modify: `MagicMirror/modules/MMM-Profile/MMM-Profile.js`

- [ ] **Step 1:** On startup, build an index of all known module classes from
      `this.config.pages` (every distinct id ever referenced).
- [ ] **Step 2:** `_resolvePage()` — given `(currentUser, now)`, walk
      `pages[user]`'s windows, evaluate each `from`/`to` cron via cron-parser,
      pick the most recently entered one. Returns the active window object
      (or null if none).
- [ ] **Step 3:** `_applyLayout(layout)` — for each module known to MM:
  - Find the layout entry whose `id` matches the module's `id` (set in
    config.js) or fall back to module name.
  - If found: `document.querySelector(".region.<position-css>")
       .appendChild(moduleEl)`, then `module.show(0)`.
  - If not: `module.hide(0)`.
- [ ] **Step 4:** Wire `_applyLayout` to fire on every state transition that
      changes the active page (wake-up, user_recognized, etc.).
- [ ] **Step 5:** Optional: schedule a one-shot `setTimeout` to the next cron
      boundary so a long-running session **does** re-evaluate on the
      transition itself — but per spec, we don't repaint mid-session, so
      skip this and confirm. (Removed for v1.)
- [ ] **Step 6:** Commit `feat(MMM-Profile): cron-driven page resolution and DOM remap`.

---

### Task 7: Create `pages.js`

**Files:**
- Create: `MagicMirror/config/pages.js`

- [ ] **Step 1:** Author the file with `globalLayout` + `Domes` (5 windows) +
      `default` (2 windows). Put existing modules' ids in the right slots.
      Use the example from the spec as starting point.
- [ ] **Step 2:** Validate via `node -e "require('./MagicMirror/config/pages.js')"`.
- [ ] **Step 3:** Commit `feat: add pages.js for MMM-Profile`.

---

### Task 8: Wire `config.js` to the new model

**Files:**
- Modify: `MagicMirror/config/config.js`

- [ ] **Step 1:** Add `id` to every module that will appear in any page layout.
- [ ] **Step 2:** Remove `position` from those modules.
- [ ] **Step 3:** Remove `classes: "Domes"` (visibility now driven by pages.js).
- [ ] **Step 4:** Remove the `MMM-Face-Reco-DNN` entry entirely.
- [ ] **Step 5:** Remove the `MMM-FaceRecoIndicator` entry (about to be deleted).
- [ ] **Step 6:** Add the `MMM-Profile` entry at `top_center` with
      `config: { pages: require("./pages.js"), defaultUser: "default" }`.
- [ ] **Step 7:** Validate: `node -e "const c = require('./MagicMirror/config/config.js'); console.log(c.modules.length, c.modules.map(m=>m.module).join(', '))"`.
- [ ] **Step 8:** Commit `feat: switch config.js to MMM-Profile + pages.js`.

---

### Task 9: Delete `MMM-FaceRecoIndicator`

**Files:**
- Delete: `MagicMirror/modules/MMM-FaceRecoIndicator/`

- [ ] **Step 1:** `git rm -r MagicMirror/modules/MMM-FaceRecoIndicator/`.
- [ ] **Step 2:** Update `CLAUDE.md` repository-layout list: remove
      MMM-FaceRecoIndicator, add MMM-Profile, mention `pages.js`.
- [ ] **Step 3:** Commit `refactor: drop MMM-FaceRecoIndicator (absorbed by MMM-Profile)`.

---

### Task 10: Pi-side install and end-to-end test

**Files:** none (test on Pi)

- [ ] **Step 1:** SSH to Pi, `git pull` in `~/MagicMirror` (or the user's repo
      checkout), `git pull` in `~/ld2450`.
- [ ] **Step 2:** `cd ~/MagicMirror/modules/MMM-Profile && npm install`.
- [ ] **Step 3:** `cd ~/ld2450` ensure `face_reco_once.py` and updated
      `ld2450_daemon.py` are in place.
- [ ] **Step 4:** `sudo systemctl restart ld2450 && journalctl -u ld2450 -n 30`
      — confirm daemon starts, no traceback.
- [ ] **Step 5:** `pm2 restart MagicMirror && pm2 logs MagicMirror --lines 50`
      — confirm MMM-Profile loads, HTTP listener mounted.
- [ ] **Step 6:** Walk into the radar zone. Expect within ~5 s:
  - Display turns on
  - MMM-Profile shows scanning animation
  - face_reco_once.py runs, posts result
  - Page switches to Domes' current-window layout
- [ ] **Step 7:** Walk out of the zone. Expect after 60 s:
  - presence_off posted
  - dimming → asleep
  - Display turns off
- [ ] **Step 8:** Walk back in. Expect re-scan + page reload.
- [ ] **Step 9:** Walk in/out within 60 s — expect no re-scan, page stays.
- [ ] **Step 10:** Commit nothing (E2E test only); update old specs/plans'
      banners with "verified working on YYYY-MM-DD" if helpful.

---

### Task 11: Backup user-owned files into the repo

**Files:**
- Mirror onto repo: `MagicMirror/config/config.js`, `MagicMirror/config/pages.js`,
  `ld2450/face_reco_once.py`, `ld2450/ld2450_daemon.py`

- [ ] **Step 1:** `scp` updated files from the Pi back into the repo paths.
- [ ] **Step 2:** Verify `git status` shows only intended changes.
- [ ] **Step 3:** Commit `chore: snapshot Pi-side files after MMM-Profile rollout`.

---

## Risks / known unknowns

1. **MM HTTP routing.** MagicMirror exposes Express on its server port; the
   correct way to mount a sub-route from a node_helper varies by MM version.
   Plan B: stand up a tiny `http.createServer` on a separate port (e.g.
   `8090`) inside the helper. Either works locally.
2. **DOM region selectors.** MM regions are `<div class="region top right">`
   etc. The `position` value (`top_right`) maps to `.top.right` (space
   instead of underscore in the class). MMM-Profile must transform.
3. **Module identifier vs id.** MM auto-assigns module identifiers like
   `module_5_weather`. We use our own custom `id` field added in `config.js`,
   matched against layout entries in `pages.js`. The `id`-to-module-instance
   map is built once on startup by iterating `MM.getModules()` and reading
   the `data.id` (custom field MM passes through to the module instance).
4. **face_reco_once.py latency.** First call cold-starts dlib (~2 s). Subsequent
   calls fast. Acceptable for a wake-up event.
5. **Camera contention.** `face_reco_once.py` opens camera; if anything else
   is using it, fails fast. Daemon retries on next presence_on. (No other
   process should be using it after we drop MMM-Face-Reco-DNN.)
