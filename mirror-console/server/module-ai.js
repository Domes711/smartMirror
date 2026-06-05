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
// Claude runs ON the Pi via the Claude Agent SDK (the Claude Code engine as a
// library) with file-only tools constrained to the module's directory. The
// browser shows a live preview by loading the module's demo.html in an iframe.
//
// Requires ANTHROPIC_API_KEY in the environment and outbound HTTPS to
// api.anthropic.com.

const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const SERVER_DIR = __dirname;
const REPO_ROOT = path.resolve(SERVER_DIR, "..", "..");
const DRAFTS_DIR = path.join(SERVER_DIR, "..", "module-drafts");
const MODULES_DIR = path.join(REPO_ROOT, "MagicMirror", "modules");
const CUSTOM_MODULES_PATH = path.join(SERVER_DIR, "..", "backend", "custom_modules.json");
const MODEL = process.env.MODULE_AI_MODEL || "claude-opus-4-8";

// The Claude Agent SDK spawns its bundled CLI with the literal command "node".
// Under the systemd service the PATH usually lacks the nvm node dir, so that
// spawn fails with `spawn node ENOENT`. Use the exact node binary already
// running this server (absolute path, no PATH lookup) and also make `node`
// resolvable for any child processes the CLI itself spawns.
const NODE_BIN = process.execPath;
{
  const dir = path.dirname(NODE_BIN || "");
  const parts = (process.env.PATH || "").split(path.delimiter);
  if (dir && !parts.includes(dir)) process.env.PATH = dir + path.delimiter + (process.env.PATH || "");
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
    mod.config = Object.assign({}, def.defaults || {});
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
    try { if (typeof mod.start === "function") mod.start(); } catch (e) {}
    mod.updateDom();
  </script>
</body>
</html>
`;
}

// ---- system prompts ------------------------------------------------------
function systemPromptAppend(scope, name) {
  const ref = `REFERENCE — read these for the exact house style:
- ${REPO_ROOT}/CLAUDE.md  (see the "Module file conventions" section)
- ${REPO_ROOT}/MagicMirror/modules/MMM-Spending/  (a complete exemplar — mirror its structure, including its demo.html scenario pattern)`;
  const common = `- demo.html MUST always stay a WORKING standalone preview — it stubs window.Module/window.Log, loads ${name}.js, calls getDom() and mounts it. This is the live preview the user is watching, so after EVERY change keep demo.html reflecting the current module. If the module shows real data, drive demo.html with hard-coded SAMPLE data (mimic what node_helper sends via socketNotificationReceived) so it renders without any backend.
- CSS classes stay namespaced. Do heavy work (API calls, secrets, file IO) in node_helper.js, never in the frontend.
Work only inside the current working directory; edit files in place. Do NOT touch CLAUDE.md or .module-chat.json — the console manages those as the conversation record. Keep chat replies short — the user is talking to you in a small side panel.`;

  if (scope === "installed") {
    return `You are EDITING an existing, already-installed MagicMirror² module named "${name}" in a smart-mirror project. Its files are in the working directory. Make the change the user asks for while keeping the module working.

${common}

${ref}`;
  }
  return `You are building a MagicMirror² module for a smart-mirror project. The working directory already contains a scaffolded module named "${name}".

HARD RULES — every module MUST follow these house conventions:
- Module name is "${name}" (MMM- prefix). Keep all files named accordingly.
- Files: ${name}.js (frontend via Module.register), ${name}.css (unique class prefix), node_helper.js (ONLY backend work — delete if unused), package.json ("private": true, "main": "${name}.js"), demo.html, README.md.
- Frontend uses Module.register("${name}", { defaults, start, getStyles, getDom, socketNotificationReceived }). getStyles() returns ["${name}.css"].
${common}

${ref}`;
}

// The internal instruction for adopting an existing module: read it, make a
// working demo.html, and describe what it does (the reply becomes the summary).
const ADOPT_PROMPT = `Adopt this existing module for visual editing:
1. Read the module's files to understand what it does and what data it renders.
2. Create or repair demo.html so the module renders standalone in a browser preview with REALISTIC sample data (stub window.Module/window.Log/window.MM, load the main JS, build via getDom(), and feed sample data the way node_helper would via socketNotificationReceived). Model it on the MMM-Spending demo.html.
3. Reply with ONE short paragraph (2–3 sentences) describing what this module does and what the preview now shows. Do not change the module's real behavior in this step — only add/repair demo.html.`;

// ---- agent turn ----------------------------------------------------------
// Guidance shown when the agent can't authenticate.
const AUTH_HINT =
  "Backend nemá platný ANTHROPIC_API_KEY. Přidej řádek `ANTHROPIC_API_KEY=sk-ant-…` " +
  "do mirror-console/server/.env (bez uvozovek a bez `export`) a restartuj: " +
  "`sudo systemctl restart mirror-console-web`. Ověř: `curl -s localhost:8000/api/modules/ai-status`.";

const looksLikeAuthError = (s) =>
  /invalid api key|please run \/login|authenticat|unauthor|x-api-key/i.test(String(s || ""));

function hasApiKey() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function runAgent(scope, name, prompt, { adopt = false } = {}) {
  const s = sessionState(scope, name);
  const cwd = dirFor(scope, name);

  if (!hasApiKey()) {
    sseSend(scope, name, { type: "error", text: AUTH_HINT });
    sseSend(scope, name, { type: "done", rev: s.rev, touched: false });
    return;
  }

  let query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch {
    sseSend(scope, name, { type: "error", text: "Claude Agent SDK není nainstalované na Pi (npm i @anthropic-ai/claude-agent-sdk)." });
    sseSend(scope, name, { type: "done", rev: s.rev, touched: false });
    return;
  }

  const options = {
    cwd,
    model: MODEL,
    executable: NODE_BIN, // spawn the SDK CLI with this node (avoids `spawn node ENOENT`)
    // Non-interactive + file-only: "dontAsk" auto-approves the pre-approved
    // allowedTools and silently denies everything else (no Bash, no prompt that
    // would hang headless), keeping the agent scoped to the module's files.
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
    systemPrompt: { type: "preset", preset: "claude_code", append: systemPromptAppend(scope, name) },
    ...(s.sessionId ? { resume: s.sessionId } : {}),
  };

  let touched = false;
  let assistantText = "";
  const files = new Set();
  try {
    for await (const msg of query({ prompt, options })) {
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
      } else if (msg.type === "result" && msg.subtype && msg.subtype !== "success") {
        const detail = msg.result || msg.error || msg.subtype;
        sseSend(scope, name, {
          type: "error",
          text: looksLikeAuthError(detail) ? AUTH_HINT : `Agent skončil: ${detail}`,
        });
      }
    }
  } catch (e) {
    sseSend(scope, name, {
      type: "error",
      text: looksLikeAuthError(e.message) ? AUTH_HINT : `Chyba agenta: ${e.message}`,
    });
  }

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

  return { ok: true, installedTo: dest, steps };
}

// ---- route wiring --------------------------------------------------------
function mountModuleAI(app, express) {
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  // Live preview (iframe loads <name>/demo.html from the right tree).
  app.use("/module-draft", express.static(DRAFTS_DIR));
  app.use("/module-installed", express.static(MODULES_DIR));

  // Diagnostics: does the backend see an API key + which node will spawn the CLI.
  // Never returns the key itself, only whether one is present.
  app.get("/api/modules/ai-status", (_req, res) => {
    res.json({ hasApiKey: hasApiKey(), keySource: process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : process.env.ANTHROPIC_AUTH_TOKEN ? "ANTHROPIC_AUTH_TOKEN" : null, model: MODEL, node: NODE_BIN });
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
