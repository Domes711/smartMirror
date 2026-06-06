// AI module builder + editor for the mirror console.
//
// Two flows, same chat+preview machinery, distinguished by `scope`:
//   - "draft"     — build a brand-new module in module-drafts/<name>, then
//                   finalize() installs it into MagicMirror/modules/.
//   - "installed" — edit an already-installed module in place inside
//                   MagicMirror/modules/<name> (the Module Store "Upravit"
//                   button). On open we ensure a demo.html (for the live
//                   preview) and a CLAUDE.md (purpose + chat history) exist.
//
// Claude runs ON the Pi via the `claude` CLI (Claude Code) with file-only
// tools constrained to the module's directory. Authentication is handled by
// `claude login` on the Pi (Max subscription) — no API key needed.
// The browser shows a live preview by loading the module's demo.html in an iframe.

const path = require("path");
const fs = require("fs");
const { execFile, spawn } = require("child_process");

const log = console; // console.info supports the %s/%d format specifiers used below

const SERVER_DIR = __dirname;
const REPO_ROOT = path.resolve(SERVER_DIR, "..", "..");
const DRAFTS_DIR = path.join(SERVER_DIR, "..", "module-drafts");
const MODULES_DIR = path.join(REPO_ROOT, "MagicMirror", "modules");
const CUSTOM_MODULES_PATH = path.join(SERVER_DIR, "..", "backend", "custom_modules.json");
const CONFIG_JS_PATH = path.join(REPO_ROOT, "MagicMirror", "config", "config.js");
const MODEL = process.env.MODULE_AI_MODEL || "claude-opus-4-8";

// Read the mirror's configured language (e.g. "cs", "en") from config.js.
// Falls back to "cs" (the mirror's default locale) when the file can't be read.
function mirrorLanguage() {
  try {
    const src = fs.readFileSync(CONFIG_JS_PATH, "utf8");
    const m = src.match(/\blanguage\s*:\s*["']([^"']+)["']/);
    return m ? m[1] : "cs";
  } catch {
    return "cs";
  }
}

// Resolve the `claude` CLI binary. Under systemd the PATH usually lacks the
// nvm node dir, so we search the nvm tree as a fallback.
function findClaude() {
  const fromEnv = process.env.CLAUDE_BIN;
  if (fromEnv) return fromEnv;
  // Already on PATH?
  try {
    const { execFileSync } = require("child_process");
    return execFileSync("which", ["claude"], { encoding: "utf8", timeout: 3000 }).trim();
  } catch { /* fall through */ }
  // Search nvm versions
  const nvmDir = process.env.NVM_DIR || path.join(require("os").homedir(), ".nvm");
  const glob = path.join(nvmDir, "versions", "node", "*", "bin", "claude");
  try {
    const { execFileSync } = require("child_process");
    const hits = execFileSync("ls", ["-t", glob], { encoding: "utf8", shell: true, timeout: 3000 })
      .split("\n").filter(Boolean);
    if (hits[0]) return hits[0].trim();
  } catch { /* not found */ }
  return null;
}

const CHAT_FILE = ".module-chat.json"; // machine transcript (console-internal)
const CLAUDE_MD = "CLAUDE.md"; // human + agent memory; lives next to the module

const NAME_RE = /^MMM-[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;

// ---- scope-aware directory + session state -------------------------------
function dirFor(scope, name) {
  return path.join(scope === "installed" ? MODULES_DIR : DRAFTS_DIR, name);
}

// In-memory per-session state, keyed by scope/name. Lost on restart — files on
// disk survive, but the chat session id does not, so a restart starts a fresh
// agent conversation (CLAUDE.md still gives it the history).
const sessions = new Map(); // "scope/name" -> { sse:Set, sessionId, rev, busy }

function sessionState(scope, name) {
  const key = `${scope}/${name}`;
  if (!sessions.has(key)) sessions.set(key, { sse: new Set(), sessionId: null, rev: 1, busy: false });
  return sessions.get(key);
}

function sseSend(scope, name, obj) {
  const s = sessions.get(`${scope}/${name}`);
  if (!s) return;
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of s.sse) res.write(line);
}

// ---- chat history (persisted so editing can be resumed later) ------------
function loadHistory(scope, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirFor(scope, name), CHAT_FILE), "utf8"));
  } catch {
    return { name, scope, description: "", prepared: false, createdAt: new Date().toISOString(), messages: [] };
  }
}

function saveHistory(scope, name, hist) {
  fs.writeFileSync(path.join(dirFor(scope, name), CHAT_FILE), JSON.stringify(hist, null, 2));
  writeClaudeMd(scope, name, hist);
}

// Regenerate CLAUDE.md from the transcript. It is the module's design memory:
// readable for humans AND auto-loaded by the Claude Agent SDK (claude_code
// preset reads CLAUDE.md from cwd), so reopening a module gives the agent its
// full history even after a backend restart dropped the in-memory session.
function writeClaudeMd(scope, name, hist) {
  const note =
    scope === "installed"
      ? "> Tento modul upravuješ přes AI úpravu modulů (mirror-console). Konzole zde\n> udržuje popis a historii konverzace — neupravuj tento soubor ručně z agenta."
      : "> Tento modul vznikl v AI tvorbě modulů (mirror-console). Soubor udržuje\n> konzole automaticky jako paměť návrhu — neupravuj ho ručně z agenta.";
  const lines = [`# ${name}`, "", "## O modulu", "", hist.description || "_(zatím bez popisu)_", "", note, "", "## Historie konverzace", ""];
  for (const m of hist.messages || []) {
    if (m.role === "user") {
      lines.push(`### 🧑 ${m.ts ? new Date(m.ts).toLocaleString("cs-CZ") : ""}`.trimEnd());
      lines.push("", (m.text || "").trim(), "");
    } else if (m.role === "assistant") {
      lines.push("**Claude:**", "", (m.text || "").trim() || "_(jen úpravy souborů)_", "");
      if (m.files && m.files.length) lines.push(`_Upravené soubory: ${m.files.join(", ")}_`, "");
    } else if (m.role === "sys") {
      lines.push(`_${(m.text || "").trim()}_`, "");
    }
  }
  fs.writeFileSync(path.join(dirFor(scope, name), CLAUDE_MD), lines.join("\n"));
}

// Normalise "Weather Plus" / "weather-plus" / "MMM-WeatherPlus" -> MMM-WeatherPlus.
function normaliseName(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^MMM-/i.test(s)) {
    s = "MMM-" + s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
  }
  s = "MMM-" + s.slice(4).replace(/[^A-Za-z0-9-]/g, "");
  return NAME_RE.test(s) ? s : null;
}

// ---- scaffold (new modules) ----------------------------------------------
// A standard 6-file MagicMirror module so the agent always starts from the
// house structure instead of inventing one.
function scaffold(name, description) {
  const cls = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    [`${name}.js`]: `/* ${name}.js — frontend (Module.register). Scaffolded by the AI module builder. */
Module.register("${name}", {
  defaults: {
    updateInterval: 60 * 1000,
  },

  getStyles() {
    return ["${name}.css"];
  },

  start() {
    Log.info("[${name}] started");
    this.viewModel = null;
  },

  socketNotificationReceived(notification, payload) {
    // Data from node_helper.js arrives here. Call this.updateDom() to re-render.
  },

  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "${cls}";
    wrap.textContent = ${JSON.stringify(description || name)};
    return wrap;
  },
});
`,
    [`${name}.css`]: `/* ${name}.css — mirror style: light text on a dark/transparent background. */
.${cls} {
  color: #fff;
  font-size: 18px;
  line-height: 1.3;
}
`,
    "node_helper.js": `/* node_helper.js — backend (network calls, file IO, secrets). Delete if unused. */
const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({
  start() {
    Log.info("[${name}] node_helper started");
  },

  socketNotificationReceived(notification, payload) {
    // Do background work here, then:
    // this.sendSocketNotification("${name.toUpperCase().replace(/-/g, "_")}_DATA", data);
  },
});
`,
    "package.json": JSON.stringify(
      {
        name: name.toLowerCase(),
        version: "0.1.0",
        description: description || `MagicMirror module ${name}`,
        main: `${name}.js`,
        private: true,
        dependencies: {},
      },
      null,
      2
    ) + "\n",
    "demo.html": genericDemoHtml(name, `${name}.js`),
    "README.md": `# ${name}

${description || "A MagicMirror² module."}

Generated with the mirror-console AI module builder.

## Install

Copy this folder into \`MagicMirror/modules/\`, then add it to \`config.js\`.
`,
  };
}

// A standalone preview harness. Stubs the MagicMirror runtime, loads the
// module's main JS, builds it via getDom() and mounts it. Used as the scaffold
// default AND as the baseline demo.html when adopting an existing module (the
// adopt agent turn then improves it with realistic sample data).
function genericDemoHtml(name, mainFile) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${name} · demo</title>
  <link rel="stylesheet" href="./${name}.css" />
  <style>
    html, body { background:#000; color:#fff; font-family:"Roboto Condensed",Helvetica,sans-serif; margin:0; padding:40px 50px; }
    #mount { display:inline-block; text-align:left; }
  </style>
</head>
<body>
  <div id="mount"></div>
  <script>
    // Stub the MagicMirror runtime so the module renders standalone.
    window.Log = console;
    window.Module = { _def: null, register: function (n, d) { this._def = d; } };
    window.MM = { sendNotification: function () {} };
  </script>
  <script src="./${mainFile}"></script>
  <script>
    const def = window.Module._def || {};
    const mountEl = document.getElementById("mount");
    const mod = Object.assign({}, def);
    mod.identifier = "demo";
    mod.name = ${JSON.stringify(name)};
    mod.data = { classes: "" };
    mod.file = function (f) { return f; };
    mod.translate = function (k) { return k; };
    mod.sendSocketNotification = function () {};
    mod.sendNotification = function () {};
    mod.updateDom = function () {
      try {
        const el = this.getDom();
        mountEl.innerHTML = "";
        if (el) mountEl.appendChild(el);
      } catch (e) {
        mountEl.textContent = "(náhled: " + e.message + ")";
      }
    };

    // ── Demo states ──────────────────────────────────────────────────────
    // Fill this with the module's meaningful states. Each apply(mod) feeds the
    // module realistic SAMPLE data the way node_helper would (e.g.
    // mod.socketNotificationReceived(...) or setting mod fields) before it
    // re-renders. The mirror-console control panel lists these states and lets
    // you switch between them while the live preview reacts. KEEP the postMessage
    // wiring below intact — just populate DEMO_STATES with good states.
    window.DEMO_STATES = window.DEMO_STATES || [
      { id: "default", label: "Výchozí", apply: function () {} },
    ];

    function applyDemoState(id) {
      const list = window.DEMO_STATES || [];
      const st = list.find(function (s) { return s.id === id; }) || list[0] || { apply: function () {} };
      mod.config = Object.assign({}, def.defaults || {});
      try { if (typeof mod.start === "function") mod.start(); } catch (e) {}
      try { st.apply && st.apply(mod); } catch (e) {}
      mod.updateDom();
    }

    function announceDemoStates() {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "mirror-demo",
            type: "states",
            states: (window.DEMO_STATES || []).map(function (s) { return { id: s.id, label: s.label || s.id }; }),
          }, "*");
        }
      } catch (e) {}
    }

    window.addEventListener("message", function (ev) {
      const d = ev.data || {};
      if (d.source !== "mirror-console") return;
      if (d.type === "set-state") applyDemoState(d.id);
      else if (d.type === "get-states") announceDemoStates();
    });

    applyDemoState((window.DEMO_STATES[0] || {}).id);
    announceDemoStates();
  </script>
</body>
</html>
`;
}

// ---- post-install screenshots ---------------------------------------------
// Captures TWO screenshots of the module's demo.html into the module directory
// and uses them as the store images: store-thumb.png (compact, landscape card)
// and store-thumb-2.png (taller, mirror-like portrait, slightly later so any
// animation / refreshed data differs). Non-fatal if playwright is missing.
const STORE_SHOTS = [
  { file: "store-thumb.png", width: 480, height: 320, delay: 1200 },
  { file: "store-thumb-2.png", width: 380, height: 600, delay: 2600 },
];

async function screenshotModule(name) {
  const dir = path.join(MODULES_DIR, name);
  const demoPath = path.join(dir, "demo.html");
  if (!fs.existsSync(demoPath)) return;
  const shots = STORE_SHOTS.map((s) => ({ ...s, path: path.join(dir, s.file) }));

  // Locate the playwright npm package in common places (no new dep needed).
  const os = require("os");
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const candidates = [
    path.join(SERVER_DIR, "node_modules", "playwright"),
    path.join(SERVER_DIR, "node_modules", "playwright-core"),
    "/opt/node22/lib/node_modules/playwright",
    "/usr/local/lib/node_modules/playwright",
    "/usr/lib/node_modules/playwright",
  ];
  // Add nvm global installs (grab all, newest first via mtime sort)
  try {
    const { execFileSync } = require("child_process");
    const hits = execFileSync("sh", ["-c",
      `ls -dt "${nvmDir}/versions/node/"*/lib/node_modules/playwright 2>/dev/null`
    ], { encoding: "utf8", timeout: 3000 }).split("\n").filter(Boolean);
    candidates.unshift(...hits.map(h => h.trim()));
  } catch { /* ignore */ }

  const pwPath = candidates.find(p => { try { return fs.existsSync(path.join(p, "index.js")); } catch { return false; } });
  if (!pwPath) {
    log.info("store-thumb skipped for %s: playwright not found", name);
    return;
  }

  const script = `
const { chromium } = require(${JSON.stringify(pwPath)});
const shots = JSON.parse(process.argv[2]);
chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }).then(async b => {
  const p = await b.newPage();
  await p.goto('file://' + process.argv[1], { waitUntil: 'load', timeout: 10000 });
  for (const sh of shots) {
    await p.setViewportSize({ width: sh.width, height: sh.height });
    await new Promise(r => setTimeout(r, sh.delay));
    await p.screenshot({ path: sh.path });
  }
  await b.close();
}).catch(e => { process.stderr.write(String(e)); process.exit(1); });`.trim();

  return new Promise((resolve) => {
    const env = { ...process.env };
    if (!env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
    const proc = spawn(process.execPath, ["-e", script, demoPath, JSON.stringify(shots)], { env });
    proc.on("close", (code) => {
      if (code === 0) log.info("store thumbnails created for %s", name);
      else log.info("store thumbnails skipped for %s (playwright exit %d)", name, code);
      resolve();
    });
    proc.on("error", () => resolve()); // non-fatal
  });
}

// ---- system prompts ------------------------------------------------------
function systemPromptAppend(scope, name) {
  const lang = mirrorLanguage();
  const langInstruction = `LANGUAGE: Always reply in the mirror's configured language (language code: "${lang}"). ` +
    `If "${lang}" is "cs", write in Czech. If "en", write in English. Match the language exactly — never switch.`;

  const tone = `TONE & COMMUNICATION STYLE — the person you are talking to is NOT a programmer:
- Use plain, friendly language. No jargon, no code terms in chat replies.
- Never explain implementation details unless explicitly asked.
- Keep replies SHORT — 1–3 sentences max. The chat panel is small.
- When you make a change, just say what it now does differently, not how.
- If something needs a value from the user (API key, URL, etc.), ask for it simply: "What is your … ?"
- Never list files you read/edited. Never mention function names, file paths, or technical steps.
- Confirm success warmly and briefly. On error, explain what went wrong in plain words and what the user should do.`;

  const ref = `TECHNICAL REFERENCE (do not mention these to the user):
- ${REPO_ROOT}/CLAUDE.md  (module file conventions)
- ${REPO_ROOT}/MagicMirror/modules/MMM-Spending/  (exemplar — mirror its structure + demo.html pattern)`;

  const common = `TECHNICAL RULES (silent — never mention in chat):
- NO INTERACTION: the mirror is a DISPLAY ONLY, mounted behind glass with NO touch screen, keyboard or pointer. The module must NEVER contain clickable or interactive elements the user would have to operate — no buttons, links, navigation, tabs, menus, form inputs, toggles or anything expecting a click/tap/hover. It only DISPLAYS information. Any state must change by itself from data, time or configuration — never from a user action. (This rule is about the module shown on the mirror, NOT about demo.html.)
- demo.html MUST always stay a WORKING standalone preview: stub window.Module/window.Log/window.MM, load ${name}.js, call getDom(), mount it. Drive with hard-coded SAMPLE data when the module uses real data.
- demo.html STATES: populate window.DEMO_STATES = [{ id, label, apply(mod){…} }] with every meaningful state of the module (e.g. loading, empty, normal, error, long/edge values). Each apply(mod) feeds realistic sample data as node_helper would (mod.socketNotificationReceived(...) or set fields) then the harness re-renders. The console control panel lists these states and the live preview reacts — keep the existing DEMO_STATES + postMessage wiring in demo.html intact.
- CSS classes stay namespaced to the module. API calls, secrets and file I/O go in node_helper.js only.
- Work only inside the current working directory. Do NOT touch CLAUDE.md or .module-chat.json.`;

  if (scope === "installed") {
    return `${langInstruction}

${tone}

You are helping a user customise an installed smart-mirror module named "${name}". Make the change they ask for while keeping the module working.

${common}

${ref}`;
  }

  return `${langInstruction}

${tone}

You are helping a user build a new smart-mirror module named "${name}". The working directory already has scaffolded files.

HARD TECHNICAL RULES:
- Module name is "${name}". Keep all files named accordingly.
- Required files: ${name}.js, ${name}.css, node_helper.js (delete if unused), package.json (private:true), demo.html, README.md.
- Frontend: Module.register("${name}", { defaults, start, getStyles, getDom, socketNotificationReceived }). getStyles() → ["${name}.css"].
${common}

${ref}`;
}

// Prompt used when adopting (analysing) a freshly installed community module.
// Runs silently after install — the user never sees the raw prompt.
const ADOPT_PROMPT = `Analyse this installed MagicMirror module and prepare it for visual editing:

1. Read ALL the module's source files to fully understand what it does, what data it shows, and what configuration it needs.
2. Write a CLAUDE.md file in the module directory with the following sections:
   - **What this module does** (2–3 sentences, plain language)
   - **Key files** (one line each: filename → what it does)
   - **Configuration** (list every config option with type and purpose)
   - **Data flow** (how data gets from the source to the display)
   - **Gotchas** (anything non-obvious a future editor must know)
3. Create or repair demo.html so the module renders standalone: stub window.Module/window.Log/window.MM, load the main JS, call getDom(), feed it REALISTIC hard-coded sample data the way node_helper would via socketNotificationReceived. Model it closely on MMM-Spending/demo.html. Also define window.DEMO_STATES = [{ id, label, apply(mod){…} }] covering the module's meaningful states (loading, empty, normal, error, edge values) and keep the postMessage wiring (set-state / get-states / "states" announce) so the console control panel can switch states while the preview reacts.
4. Reply with ONE plain-language sentence describing what this module shows on the mirror. Nothing else.

Note: the mirror is a display only with NO touch input — modules must never include clickable/interactive elements; they only display information.`;

// ---- agent turn ----------------------------------------------------------
const AUTH_HINT =
  "Claude CLI není přihlášen. Na Pi spusť: `claude login` (přihlásíš se Max účtem).\n" +
  "Pokud `claude` CLI ještě není nainstalované: `npm install -g @anthropic-ai/claude-code`.\n" +
  "Ověř: `curl -s localhost:8000/api/modules/ai-status`.";

const looksLikeAuthError = (s) =>
  /invalid api key|please run \/login|authenticat|unauthor|x-api-key|credit balance|billing/i.test(String(s || ""));

async function runAgent(scope, name, prompt, { adopt = false } = {}) {
  const s = sessionState(scope, name);
  const cwd = dirFor(scope, name);

  const claudeBin = findClaude();
  if (!claudeBin) {
    sseSend(scope, name, { type: "error", text: AUTH_HINT });
    sseSend(scope, name, { type: "done", rev: s.rev, touched: false });
    return;
  }

  // Build CLI args — equivalent to the former SDK options object.
  const args = [
    "--print", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--model", MODEL,
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch",
    "--append-system-prompt", systemPromptAppend(scope, name),
  ];
  if (s.sessionId) args.push("--resume", s.sessionId);

  let touched = false;
  let assistantText = "";
  const files = new Set();

  await new Promise((resolve) => {
    const proc = spawn(claudeBin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";

    const handleLine = (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.session_id) s.sessionId = msg.session_id;
      if (msg.type === "assistant") {
        for (const block of msg.message?.content || []) {
          if (block.type === "text" && block.text) {
            assistantText += block.text;
            sseSend(scope, name, { type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            const f = path.basename(block.input?.file_path || block.input?.path || "");
            if (f) files.add(f);
            if (block.name === "Write" || block.name === "Edit") touched = true;
            sseSend(scope, name, { type: "tool", tool: block.name, file: f });
          }
        }
      } else if (msg.type === "result") {
        if (msg.session_id) s.sessionId = msg.session_id;
        if (msg.subtype && msg.subtype !== "success") {
          const detail = msg.result || msg.error || msg.subtype;
          sseSend(scope, name, {
            type: "error",
            text: looksLikeAuthError(detail) ? AUTH_HINT : `Agent skončil: ${detail}`,
          });
        }
      }
    };

    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      lines.forEach(handleLine);
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) sseSend(scope, name, { type: "tool", tool: "log", file: text.slice(0, 120) });
    });

    proc.on("close", (code) => {
      if (buf.trim()) handleLine(buf);
      if (code !== 0 && !assistantText) {
        sseSend(scope, name, {
          type: "error",
          text: looksLikeAuthError(buf + assistantText)
            ? AUTH_HINT
            : `Claude CLI skončil s kódem ${code}. Zkontroluj: journalctl -u mirror-console-web -n 30`,
        });
      }
      resolve();
    });

    proc.on("error", (e) => {
      sseSend(scope, name, {
        type: "error",
        text: looksLikeAuthError(e.message) ? AUTH_HINT : `Chyba spuštění: ${e.message}`,
      });
      resolve();
    });
  });

  // Persist this turn so the conversation can be reopened later.
  const hist = loadHistory(scope, name);
  if (adopt) {
    if (assistantText.trim()) hist.description = assistantText.trim();
    hist.prepared = true;
    hist.messages.push({ role: "sys", text: "Modul načten k úpravám.", ts: Date.now() });
    hist.messages.push({ role: "assistant", text: assistantText, files: [...files], ts: Date.now() });
  } else {
    hist.messages.push({ role: "user", text: prompt, ts: Date.now() });
    hist.messages.push({ role: "assistant", text: assistantText, files: [...files], ts: Date.now() });
  }
  try {
    saveHistory(scope, name, hist);
  } catch (e) {
    sseSend(scope, name, { type: "error", text: `Historie se neuložila: ${e.message}` });
  }

  // Refresh the two store screenshots from the live demo.html whenever an
  // installed module is adopted or edited (non-blocking, best-effort). Drafts
  // get their screenshots at finalize time, once they live under modules/.
  if (scope === "installed" && (adopt || touched)) screenshotModule(name).catch(() => {});

  if (touched) s.rev += 1;
  sseSend(scope, name, { type: "done", rev: s.rev, touched });
}

// ---- catalog registration (shared with the Python supervisor) ------------
// The supervisor merges custom_modules.json into its catalog at request time,
// so a finalized module shows up in the layout editor with no restart.
function registerCatalog(name, description) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(CUSTOM_MODULES_PATH, "utf8"));
    if (!Array.isArray(list)) list = [];
  } catch {
    /* missing/invalid -> start fresh */
  }
  const label = `${name.replace(/^MMM-/, "")} (AI)`;
  const entry = { type: name, module: name, label, fields: [], ai: true, description };
  const i = list.findIndex((c) => c && c.type === name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  fs.mkdirSync(path.dirname(CUSTOM_MODULES_PATH), { recursive: true });
  const tmp = CUSTOM_MODULES_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, CUSTOM_MODULES_PATH); // atomic: avoid torn reads in supervisor
}

// ---- shell helpers -------------------------------------------------------
function runCmd(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, timeout: 180000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code, stdout: stdout || "", stderr: stderr || (err ? err.message : "") });
    });
  });
}

async function finalize(name, overwrite) {
  const src = path.join(DRAFTS_DIR, name);
  if (!fs.existsSync(src)) return { ok: false, error: "draft neexistuje" };
  const dest = path.join(MODULES_DIR, name);
  if (fs.existsSync(dest) && !overwrite) return { ok: false, error: "modul už existuje", exists: true };

  fs.cpSync(src, dest, {
    recursive: true,
    filter: (s) => !s.split(path.sep).includes("node_modules") && path.basename(s) !== CHAT_FILE,
  });

  // Make the module placeable in the layout editor (Profily → Rozložení).
  registerCatalog(name, loadHistory("draft", name).description || "");

  const steps = [];
  let deps = {};
  try {
    deps = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).dependencies || {};
  } catch {
    /* ignore */
  }
  if (Object.keys(deps).length > 0) {
    steps.push({ step: "npm install", ...(await runCmd("npm", ["install", "--omit=dev"], { cwd: dest })) });
  }
  steps.push({ step: "pm2 restart MagicMirror", ...(await runCmd("pm2", ["restart", "MagicMirror"])) });

  // Capture the two store screenshots from the freshly installed demo.html.
  await screenshotModule(name).catch(() => {});

  return { ok: true, installedTo: dest, steps };
}

// ---- route wiring --------------------------------------------------------
function mountModuleAI(app, express) {
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  // Live preview (iframe loads <name>/demo.html from the right tree).
  app.use("/module-draft", express.static(DRAFTS_DIR));
  app.use("/module-installed", express.static(MODULES_DIR));

  // Diagnostics: is claude CLI available + which model will be used.
  app.get("/api/modules/ai-status", (_req, res) => {
    const { execFileSync } = require("child_process");
    const claudeBin = findClaude();
    let claudeVersion = null;
    try {
      if (claudeBin) claudeVersion = execFileSync(claudeBin, ["--version"], { timeout: 5000, encoding: "utf8" }).trim();
    } catch { /* CLI found but --version failed */ }
    res.json({ claudeCli: !!claudeBin, claudeVersion, claudeBin, model: MODEL });
  });

  // scope from query/body; "draft" unless explicitly "installed".
  const scopeOf = (v) => (v === "installed" ? "installed" : "draft");

  app.get("/api/modules/list", (_req, res) => {
    const names = fs.existsSync(DRAFTS_DIR)
      ? fs.readdirSync(DRAFTS_DIR).filter((n) => fs.statSync(path.join(DRAFTS_DIR, n)).isDirectory())
      : [];
    const drafts = names.map((n) => ({ name: n, description: loadHistory("draft", n).description || "" }));
    res.json({ drafts });
  });

  app.post("/api/modules/draft", (req, res) => {
    const name = normaliseName(req.body?.name);
    if (!name) return res.status(400).json({ error: "neplatné jméno (MMM-Něco, písmena/číslice/-)" });
    const description = String(req.body?.description || "").slice(0, 2000);
    const dir = path.join(DRAFTS_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [fname, content] of Object.entries(scaffold(name, description))) {
      const p = path.join(dir, fname);
      if (!fs.existsSync(p)) fs.writeFileSync(p, content);
    }
    const existing = loadHistory("draft", name);
    saveHistory("draft", name, {
      name,
      scope: "draft",
      description: description || existing.description || "",
      prepared: existing.prepared || false,
      createdAt: existing.createdAt || new Date().toISOString(),
      messages: existing.messages || [],
    });
    const s = sessionState("draft", name);
    s.sessionId = null;
    s.rev += 1;
    res.json({ ok: true, name, rev: s.rev });
  });

  // Open an installed module for editing: ensure demo.html (preview) + history.
  app.post("/api/modules/edit/open", (req, res) => {
    const name = normaliseName(req.body?.name);
    const dir = name && path.join(MODULES_DIR, name);
    if (!name || !dir || !fs.existsSync(dir))
      return res.status(404).json({ error: "modul není nainstalovaný" });
    // baseline demo.html so the preview iframe has something to load
    const demo = path.join(dir, "demo.html");
    if (!fs.existsSync(demo)) {
      let main = `${name}.js`;
      try {
        main = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).main || main;
      } catch {
        /* ignore */
      }
      fs.writeFileSync(demo, genericDemoHtml(name, main));
    }
    const hist = loadHistory("installed", name);
    if (!fs.existsSync(path.join(dir, CHAT_FILE))) saveHistory("installed", name, hist);
    sessionState("installed", name).rev += 1;
    res.json({ ok: true, name, prepared: !!hist.prepared, messages: hist.messages, description: hist.description });
  });

  // Run the one-time adopt turn (read module, fix demo.html, describe it).
  app.post("/api/modules/edit/prepare", async (req, res) => {
    const name = normaliseName(req.body?.name);
    if (!name || !fs.existsSync(path.join(MODULES_DIR, name)))
      return res.status(404).json({ error: "modul není nainstalovaný" });
    const s = sessionState("installed", name);
    if (s.busy) return res.status(409).json({ error: "agent zrovna pracuje" });
    if (loadHistory("installed", name).prepared) return res.json({ ok: true, alreadyPrepared: true });
    s.busy = true;
    res.json({ ok: true });
    try {
      await runAgent("installed", name, ADOPT_PROMPT, { adopt: true });
    } finally {
      s.busy = false;
    }
  });

  // Called by the install worker after a fresh community module install:
  // runs adopt (demo.html + CLAUDE.md analysis) in the background.
  // Returns immediately — poll /api/modules/session for prepared:true.
  app.post("/api/modules/adopt", (req, res) => {
    const name = normaliseName(req.body?.name);
    if (!name || !fs.existsSync(path.join(MODULES_DIR, name)))
      return res.status(404).json({ error: "modul není nainstalovaný" });
    const s = sessionState("installed", name);
    if (s.busy) return res.json({ ok: true, alreadyRunning: true });
    if (loadHistory("installed", name).prepared) return res.json({ ok: true, alreadyPrepared: true });
    s.busy = true;
    res.json({ ok: true, started: true });
    runAgent("installed", name, ADOPT_PROMPT, { adopt: true }).finally(() => { s.busy = false; });
  });

  // Apply in-place edits to the running mirror.
  app.post("/api/modules/edit/restart", async (_req, res) => {
    const r = await runCmd("pm2", ["restart", "MagicMirror"]);
    res.status(r.ok ? 200 : 500).json(r);
  });

  // Session info (description + transcript) for either scope.
  app.get("/api/modules/session", (req, res) => {
    const scope = scopeOf(req.query?.scope);
    const name = normaliseName(req.query?.name);
    if (!name || !fs.existsSync(dirFor(scope, name)))
      return res.status(404).json({ error: "neexistuje" });
    const hist = loadHistory(scope, name);
    res.json({
      name,
      scope,
      description: hist.description,
      prepared: !!hist.prepared,
      messages: hist.messages,
      rev: sessionState(scope, name).rev,
    });
  });
  // Back-compat alias used by the new-module wizard.
  app.get("/api/modules/draft", (req, res) => {
    const name = normaliseName(req.query?.name);
    if (!name || !fs.existsSync(dirFor("draft", name)))
      return res.status(404).json({ error: "draft neexistuje" });
    const hist = loadHistory("draft", name);
    res.json({ name, description: hist.description, messages: hist.messages, rev: sessionState("draft", name).rev });
  });

  // SSE stream of agent output for one session.
  app.get("/api/modules/chat/stream", (req, res) => {
    const scope = scopeOf(req.query?.scope);
    const name = normaliseName(req.query?.name);
    if (!name) return res.status(400).end();
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    if (res.flushHeaders) res.flushHeaders();
    const s = sessionState(scope, name);
    res.write(`data: ${JSON.stringify({ type: "connected", rev: s.rev })}\n\n`);
    s.sse.add(res);
    req.on("close", () => s.sse.delete(res));
  });

  // Run one agent turn. Output streams over the SSE channel above.
  app.post("/api/modules/chat", async (req, res) => {
    const scope = scopeOf(req.body?.scope);
    const name = normaliseName(req.body?.name);
    const message = String(req.body?.message || "").trim();
    if (!name || !fs.existsSync(dirFor(scope, name)))
      return res.status(400).json({ error: "modul neexistuje" });
    if (!message) return res.status(400).json({ error: "prázdná zpráva" });
    const s = sessionState(scope, name);
    if (s.busy) return res.status(409).json({ error: "agent zrovna pracuje" });
    s.busy = true;
    res.json({ ok: true });
    try {
      await runAgent(scope, name, message);
    } finally {
      s.busy = false;
    }
  });

  app.post("/api/modules/finalize", async (req, res) => {
    const name = normaliseName(req.body?.name);
    if (!name) return res.status(400).json({ error: "neplatné jméno" });
    try {
      const result = await finalize(name, !!req.body?.overwrite);
      res.status(result.ok ? 200 : result.exists ? 409 : 400).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = {
  mountModuleAI,
  scaffold,
  genericDemoHtml,
  normaliseName,
  // exported for tests:
  loadHistory,
  saveHistory,
  writeClaudeMd,
  registerCatalog,
  CUSTOM_MODULES_PATH,
  DRAFTS_DIR,
  MODULES_DIR,
};
