// AI module builder for the mirror console.
//
// Lets the user create a brand-new MagicMirror² module by chatting with Claude.
// Claude runs ON the Pi via the Claude Agent SDK (the Claude Code engine as a
// library): it edits a scaffolded draft module in place; the browser shows a
// live preview by loading the module's demo.html in an <iframe>.
//
// Flow:
//   POST /api/modules/draft      {name, description}  -> scaffold a draft
//   GET  /api/modules/chat/stream?name=NAME           -> SSE: agent output
//   POST /api/modules/chat       {name, message}      -> run one agent turn
//   GET  /module-draft/<name>/demo.html               -> live preview (static)
//   POST /api/modules/finalize   {name}               -> install onto the mirror
//
// Requires ANTHROPIC_API_KEY in the environment and outbound HTTPS to
// api.anthropic.com. The agent is constrained to file tools inside the draft
// directory (no Bash) so it can only touch the module it is building.

const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const SERVER_DIR = __dirname;
const REPO_ROOT = path.resolve(SERVER_DIR, "..", "..");
const DRAFTS_DIR = path.join(SERVER_DIR, "..", "module-drafts");
const MODULES_DIR = path.join(REPO_ROOT, "MagicMirror", "modules");
const CUSTOM_MODULES_PATH = path.join(SERVER_DIR, "..", "backend", "custom_modules.json");
const MODEL = process.env.MODULE_AI_MODEL || "claude-opus-4-8";

const CHAT_FILE = ".module-chat.json"; // machine transcript (console-internal)
const CLAUDE_MD = "CLAUDE.md"; // human + agent memory; ships with the module

const NAME_RE = /^MMM-[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;

// In-memory per-draft state. Lost on restart — drafts on disk survive, but the
// chat session id does not, so a restart starts a fresh conversation.
const drafts = new Map(); // name -> { sse:Set, sessionId, rev, busy }

function draftState(name) {
  if (!drafts.has(name)) drafts.set(name, { sse: new Set(), sessionId: null, rev: 1, busy: false });
  return drafts.get(name);
}

function sseSend(name, obj) {
  const d = drafts.get(name);
  if (!d) return;
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of d.sse) res.write(line);
}

// ---- chat history (persisted so editing can be resumed later) ------------
function draftDir(name) {
  return path.join(DRAFTS_DIR, name);
}

function loadHistory(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(draftDir(name), CHAT_FILE), "utf8"));
  } catch {
    return { name, description: "", createdAt: new Date().toISOString(), messages: [] };
  }
}

function saveHistory(name, hist) {
  fs.writeFileSync(path.join(draftDir(name), CHAT_FILE), JSON.stringify(hist, null, 2));
  writeClaudeMd(name, hist);
}

// Regenerate CLAUDE.md from the transcript. It is the module's design memory:
// readable for humans AND auto-loaded by the Claude Agent SDK (claude_code
// preset reads CLAUDE.md from cwd), so reopening a module gives the agent its
// full history even after a backend restart dropped the in-memory session.
function writeClaudeMd(name, hist) {
  const lines = [
    `# ${name}`,
    "",
    hist.description || "_(bez popisu)_",
    "",
    "> Tento modul vznikl v AI tvorbě modulů (mirror-console). Soubor udržuje",
    "> konzole automaticky jako paměť návrhu — neupravuj ho ručně z agenta.",
    "",
    "## Historie konverzace",
    "",
  ];
  for (const m of hist.messages || []) {
    if (m.role === "user") {
      lines.push(`### 🧑 ${m.ts ? new Date(m.ts).toLocaleString("cs-CZ") : ""}`.trimEnd());
      lines.push("", m.text.trim(), "");
    } else if (m.role === "assistant") {
      lines.push("**Claude:**", "", (m.text || "").trim() || "_(jen úpravy souborů)_", "");
      if (m.files && m.files.length) lines.push(`_Upravené soubory: ${m.files.join(", ")}_`, "");
    }
  }
  fs.writeFileSync(path.join(draftDir(name), CLAUDE_MD), lines.join("\n"));
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

// ---- scaffold ------------------------------------------------------------
// A standard 6-file MagicMirror module so the agent always starts from the
// house structure instead of inventing one. The class suffix (mmfoo-style) is
// derived from the name.
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
    // this.sendSocketNotification("${name.toUpperCase().replace(/-/g, "_")}_INIT", this.config);
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
    "demo.html": `<!DOCTYPE html>
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
    // Stub the MagicMirror runtime so the module file can register & render standalone.
    window.Log = console;
    window.Module = { _def: null, register: function (n, d) { this._def = d; } };
    window.MM = { sendNotification: function () {} };
  </script>
  <script src="./${name}.js"></script>
  <script>
    const def = window.Module._def;
    const mountEl = document.getElementById("mount");
    const mod = Object.assign({}, def);
    mod.config = Object.assign({}, def.defaults || {});
    mod.identifier = "demo";
    mod.name = "${name}";
    mod.file = function (f) { return f; };
    mod.translate = function (k) { return k; };
    mod.sendSocketNotification = function () {};
    mod.sendNotification = function () {};
    mod.updateDom = function () {
      const el = this.getDom();
      mountEl.innerHTML = "";
      if (el) mountEl.appendChild(el);
    };
    if (typeof mod.start === "function") { try { mod.start(); } catch (e) { console.warn(e); } }
    mod.updateDom();
  </script>
</body>
</html>
`,
    "README.md": `# ${name}

${description || "A MagicMirror² module."}

Generated with the mirror-console AI module builder.

## Install

Copy this folder into \`MagicMirror/modules/\`, then add it to \`config.js\`.
`,
  };
}

function systemPromptAppend(name) {
  return `You are building a MagicMirror² module for a smart-mirror project. The working directory already contains a scaffolded module named "${name}".

HARD RULES — every module MUST follow these house conventions:
- Module name is "${name}" (MMM- prefix). Keep all files named accordingly.
- Files: ${name}.js (frontend via Module.register), ${name}.css (unique class prefix), node_helper.js (ONLY backend work — network/file/subprocess; delete it if the module needs no backend), package.json ("private": true, "main": "${name}.js"), demo.html, README.md.
- Frontend uses Module.register("${name}", { defaults, start, getStyles, getDom, socketNotificationReceived }). getStyles() returns ["${name}.css"].
- CSS: namespace every class. Light text on a dark/transparent background (mirror style).
- demo.html MUST always stay a WORKING standalone preview — it stubs window.Module/window.Log, loads ${name}.js, calls getDom() and mounts it. This is the live preview the user is watching, so after EVERY change make sure demo.html reflects the current module. If the module shows real data, drive demo.html with hard-coded sample scenarios (it must render without any backend).
- Do all heavy work (API calls, secrets, file IO) in node_helper.js, never in the frontend; communicate via sendSocketNotification / socketNotificationReceived.

REFERENCE — read these for the exact house style:
- ${REPO_ROOT}/CLAUDE.md  (see the "Module file conventions" section)
- ${REPO_ROOT}/MagicMirror/modules/MMM-Spending/  (a complete exemplar — mirror its structure, including its demo.html scenario pattern)

Work only inside the current working directory; edit the scaffold files in place. Do NOT touch CLAUDE.md or .module-chat.json — the console manages those as the conversation record. Keep chat replies short — the user is talking to you in a small side panel.`;
}

// ---- agent turn ----------------------------------------------------------
async function runAgent(name, userMessage) {
  const d = draftState(name);
  const cwd = path.join(DRAFTS_DIR, name);
  let query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (e) {
    sseSend(name, { type: "error", text: "Claude Agent SDK není nainstalované na Pi (npm i @anthropic-ai/claude-agent-sdk)." });
    sseSend(name, { type: "done", rev: d.rev, touched: false });
    return;
  }

  const options = {
    cwd,
    model: MODEL,
    permissionMode: "bypassPermissions",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
    systemPrompt: { type: "preset", preset: "claude_code", append: systemPromptAppend(name) },
    ...(d.sessionId ? { resume: d.sessionId } : {}),
  };

  let touched = false;
  let assistantText = "";
  const files = new Set();
  try {
    for await (const msg of query({ prompt: userMessage, options })) {
      if (msg.session_id) d.sessionId = msg.session_id;
      if (msg.type === "assistant") {
        for (const block of msg.message?.content || []) {
          if (block.type === "text" && block.text) {
            assistantText += block.text;
            sseSend(name, { type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            const f = path.basename(block.input?.file_path || block.input?.path || "");
            if (f) files.add(f);
            if (block.name === "Write" || block.name === "Edit") touched = true;
            sseSend(name, { type: "tool", tool: block.name, file: f });
          }
        }
      } else if (msg.type === "result" && msg.subtype && msg.subtype !== "success") {
        sseSend(name, { type: "error", text: `Agent skončil: ${msg.subtype}` });
      }
    }
  } catch (e) {
    sseSend(name, { type: "error", text: `Chyba agenta: ${e.message}` });
  }

  // Persist this turn so the conversation can be reopened later.
  const hist = loadHistory(name);
  hist.messages.push({ role: "user", text: userMessage, ts: Date.now() });
  hist.messages.push({ role: "assistant", text: assistantText, files: [...files], ts: Date.now() });
  try {
    saveHistory(name, hist);
  } catch (e) {
    sseSend(name, { type: "error", text: `Historie se neuložila: ${e.message}` });
  }

  if (touched) d.rev += 1;
  sseSend(name, { type: "done", rev: d.rev, touched });
}

// ---- catalog registration (shared with the Python supervisor) ------------
// The supervisor merges custom_modules.json into MODULE_CATALOG at request
// time, so a finalized module shows up in the layout editor with no restart.
// AI modules have no required config fields (empty config is valid).
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

// ---- finalize: install onto the running mirror ---------------------------
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
  const description = loadHistory(name).description || "";
  registerCatalog(name, description);

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

  // Live preview of a draft module (iframe loads demo.html from here).
  app.use("/module-draft", express.static(DRAFTS_DIR));

  app.get("/api/modules/list", (_req, res) => {
    const names = fs.existsSync(DRAFTS_DIR)
      ? fs.readdirSync(DRAFTS_DIR).filter((n) => fs.statSync(path.join(DRAFTS_DIR, n)).isDirectory())
      : [];
    const drafts = names.map((n) => ({ name: n, description: loadHistory(n).description || "" }));
    res.json({ drafts });
  });

  app.post("/api/modules/draft", (req, res) => {
    const name = normaliseName(req.body?.name);
    if (!name) return res.status(400).json({ error: "neplatné jméno (MMM-Něco, písmena/číslice/-)" });
    const description = String(req.body?.description || "").slice(0, 2000);
    const dir = path.join(DRAFTS_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const files = scaffold(name, description);
    for (const [fname, content] of Object.entries(files)) {
      const p = path.join(dir, fname);
      if (!fs.existsSync(p)) fs.writeFileSync(p, content);
    }
    const existing = loadHistory(name);
    const hist = {
      name,
      description: description || existing.description || "",
      createdAt: existing.createdAt || new Date().toISOString(),
      messages: existing.messages || [],
    };
    saveHistory(name, hist);
    const d = draftState(name);
    d.sessionId = null;
    d.rev += 1;
    res.json({ ok: true, name, rev: d.rev });
  });

  // Reopen a draft: its description + full chat transcript for the UI.
  app.get("/api/modules/draft", (req, res) => {
    const name = normaliseName(req.query?.name);
    if (!name || !fs.existsSync(draftDir(name)))
      return res.status(404).json({ error: "draft neexistuje" });
    const hist = loadHistory(name);
    res.json({ name, description: hist.description, messages: hist.messages, rev: draftState(name).rev });
  });

  // SSE stream of agent output for one draft.
  app.get("/api/modules/chat/stream", (req, res) => {
    const name = normaliseName(req.query?.name);
    if (!name) return res.status(400).end();
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    if (res.flushHeaders) res.flushHeaders();
    const d = draftState(name);
    res.write(`data: ${JSON.stringify({ type: "connected", rev: d.rev })}\n\n`);
    d.sse.add(res);
    req.on("close", () => d.sse.delete(res));
  });

  // Run one agent turn. Output streams over the SSE channel above.
  app.post("/api/modules/chat", async (req, res) => {
    const name = normaliseName(req.body?.name);
    const message = String(req.body?.message || "").trim();
    if (!name || !fs.existsSync(path.join(DRAFTS_DIR, name)))
      return res.status(400).json({ error: "draft neexistuje" });
    if (!message) return res.status(400).json({ error: "prázdná zpráva" });
    const d = draftState(name);
    if (d.busy) return res.status(409).json({ error: "agent zrovna pracuje" });
    d.busy = true;
    res.json({ ok: true });
    try {
      await runAgent(name, message);
    } finally {
      d.busy = false;
    }
  });

  app.post("/api/modules/finalize", async (req, res) => {
    const name = normaliseName(req.body?.name);
    if (!name) return res.status(400).json({ error: "neplatné jméno" });
    try {
      const result = await finalize(name, !!req.body?.overwrite);
      res.status(result.ok ? 200 : (result.exists ? 409 : 400)).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = {
  mountModuleAI,
  scaffold,
  normaliseName,
  // exported for tests:
  loadHistory,
  saveHistory,
  writeClaudeMd,
  registerCatalog,
  CUSTOM_MODULES_PATH,
  DRAFTS_DIR,
};
