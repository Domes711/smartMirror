"""Runs the `claude` CLI as a subprocess, constrained to one module's working
copy directory. Stateless: service.py always hands in whatever
claude_session_id it has from the DB and receives a new one back to store —
nothing here is kept in memory between calls.
"""

import json
import logging
import os
import subprocess

from features.ai_modules import prompts

log = logging.getLogger("ai_modules.agent")

MODEL = os.environ.get("MODULE_AI_MODEL", "claude-opus-4-8")

ALLOWED_TOOLS = "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch"


def find_claude():
    """Resolve the `claude` binary. Under systemd the PATH usually lacks the
    nvm node dir, so fall back to searching the nvm tree."""
    from_env = os.environ.get("CLAUDE_BIN")
    if from_env:
        return from_env
    try:
        out = subprocess.run(["which", "claude"], capture_output=True,
                             text=True, timeout=3)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    nvm = os.environ.get("NVM_DIR") or os.path.expanduser("~/.nvm")
    try:
        out = subprocess.run(
            ["sh", "-c", f'ls -t "{nvm}"/versions/node/*/bin/claude 2>/dev/null'],
            capture_output=True, text=True, timeout=3)
        hit = (out.stdout or "").strip().split("\n")[0].strip()
        if hit:
            return hit
    except Exception:  # noqa: BLE001
        pass
    return None


def make_claude_md(name: str, description: str, history: list) -> str:
    """Human-readable record of the module: description + conversation
    history. The agent's own memory is the CLI's --resume session, not this
    file — this is documentation, written once, at install()."""
    lines = [f"# {name}", "", "## O modulu", "",
             description or "_(zatím bez popisu)_", "",
             "> Tento modul vznikl/je upravovaný přes AI tvorbu modulů.",
             "", "## Historie konverzace", ""]
    for m in history or []:
        role, text = m.get("role"), (m.get("text") or "").strip()
        if role == "user":
            lines += ["### 🧑", "", text, ""]
        elif role == "assistant":
            lines += ["**Claude:**", "", text or "_(jen úpravy souborů)_", ""]
        elif role == "sys":
            lines += [f"_{text}_", ""]
    return "\n".join(lines)


def run(scope: str, name: str, prompt: str, cwd: str,
        claude_session_id: str = None, on_event=None) -> dict:
    """One agent turn. Streams events to `on_event(event_dict)` as they
    happen, then returns {assistant_text, claude_session_id, touched_files}.
    """
    on_event = on_event or (lambda event: None)

    claude_bin = find_claude()
    if not claude_bin:
        on_event({"type": "error", "text": prompts.AUTH_HINT})
        return {"assistant_text": "", "claude_session_id": claude_session_id,
                "touched_files": []}

    args = [
        claude_bin,
        "--print", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--model", MODEL,
        "--permission-mode", "dontAsk",
        "--allowedTools", ALLOWED_TOOLS,
        "--append-system-prompt", prompts.system_prompt(scope, name),
    ]
    if claude_session_id:
        args += ["--resume", claude_session_id]

    touched = False
    assistant_text = ""
    files = []
    session_id = claude_session_id

    def handle_line(line: str) -> None:
        nonlocal touched, assistant_text, session_id
        if not line.strip():
            return
        try:
            msg = json.loads(line)
        except Exception:  # noqa: BLE001
            return
        if msg.get("session_id"):
            session_id = msg["session_id"]
        if msg.get("type") == "assistant" and not msg.get("error"):
            for block in (msg.get("message") or {}).get("content") or []:
                if block.get("type") == "text" and block.get("text"):
                    assistant_text += block["text"]
                    on_event({"type": "text", "text": block["text"]})
                elif block.get("type") == "tool_use":
                    inp = block.get("input") or {}
                    f = os.path.basename(inp.get("file_path")
                                         or inp.get("path") or "")
                    if f and f not in files:
                        files.append(f)
                    if block.get("name") in ("Write", "Edit"):
                        touched = True
                    on_event({"type": "tool", "tool": block.get("name"),
                             "file": f})
        elif msg.get("type") == "result":
            sub = msg.get("subtype")
            if msg.get("is_error") or (sub and sub != "success"):
                detail = msg.get("result") or msg.get("error") or sub
                on_event({
                    "type": "error",
                    "text": prompts.AUTH_HINT
                            if prompts.looks_like_auth_error(detail)
                            else f"Agent skončil: {detail}"})

    proc = subprocess.Popen(args, cwd=cwd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1)

    for line in proc.stdout:
        handle_line(line)
    stderr_tail = proc.stderr.read()
    code = proc.wait()

    if code != 0 and not assistant_text:
        log.error("claude CLI exited %s: %s", code, stderr_tail[-500:])
        on_event({
            "type": "error",
            "text": prompts.AUTH_HINT
                    if prompts.looks_like_auth_error(stderr_tail)
                    else f"Claude CLI skončil s kódem {code}."})

    on_event({"type": "done", "touched": touched})
    return {"assistant_text": assistant_text, "claude_session_id": session_id,
           "touched_files": files}
