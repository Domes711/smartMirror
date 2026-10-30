"""Business logic for the ai_modules feature, on demand.

The single orchestrator: agent.py, workspace.py, templates.py, prompts.py and
data.ai_module_sessions / data.ai_module_messages / data.module_catalog are
all plain workers that know nothing about each other — only service.py calls
more than one of them, and only service.py decides what happens next.
"""

import json
import logging
import re
import threading

from data import ai_module_messages, ai_module_sessions, module_catalog
from features.ai_modules import agent, constants, prompts, templates, workspace

log = logging.getLogger("ai_modules.service")

_stream_publisher = None  # set by mqtt.py: fn(scope, name, event_dict)


def set_stream_publisher(fn) -> None:
    global _stream_publisher
    _stream_publisher = fn


def _publish(scope: str, name: str, event: dict) -> None:
    if _stream_publisher is not None:
        _stream_publisher(scope, name, event)


def status() -> dict:
    claude_bin = agent.find_claude()
    return {"claudeCli": bool(claude_bin), "claudeBin": claude_bin,
           "model": agent.MODEL}


def list_drafts() -> dict:
    rows = ai_module_sessions.list_by_scope("draft")
    return {"drafts": [{"name": r["name"], "description": r["description"]}
                       for r in rows]}


def draft_create(name: str, description: str = "") -> dict:
    files = templates.scaffold(name, description)
    workspace.write_files(name, files)
    session_id = ai_module_sessions.create("draft", name, description)
    return {"ok": True, "name": name, "sessionId": session_id}


def edit_open(name: str) -> dict:
    """Start/resume editing an installed module (AI-built or community) by
    copying it into a working copy as a draft. A module with no session yet
    gets adopted: the agent's first turn reads its source and describes it.
    """
    existing = ai_module_sessions.get_by_name(name)
    is_new = existing is None

    if existing is None:
        session_id = ai_module_sessions.create("draft", name)
    else:
        session_id = existing["id"]
        ai_module_sessions.set_scope(session_id, "draft")

    workspace.copy_from_installed(name)

    if is_new:
        _run_turn("installed", name, session_id, prompts.ADOPT_PROMPT,
                 claude_session_id=None, save_user_message=False)

    return {"ok": True, "name": name, "sessionId": session_id}


def _run_turn(scope: str, name: str, session_id: int, prompt: str,
             claude_session_id: str, save_user_message: bool) -> dict:
    if save_user_message:
        ai_module_messages.add(session_id, "user", prompt)

    def on_event(event: dict) -> None:
        _publish(scope, name, event)

    result = agent.run(scope, name, prompt, workspace.path_for(name),
                       claude_session_id, on_event)

    if result["assistant_text"]:
        ai_module_messages.add(session_id, "assistant", result["assistant_text"])
        ai_module_sessions.set_description(session_id, result["assistant_text"])
    if result["claude_session_id"]:
        ai_module_sessions.set_claude_session_id(session_id,
                                                 result["claude_session_id"])
    return result


def new_message(scope: str, name: str, message: str) -> dict:
    session = ai_module_sessions.get_by_name(name)
    if session is None:
        return {"ok": False, "error": "modul neexistuje"}
    if not message.strip():
        return {"ok": False, "error": "prázdná zpráva"}

    def go():
        _run_turn(scope, name, session["id"], message,
                 session["claude_session_id"], save_user_message=True)

    threading.Thread(target=go, daemon=True).start()
    return {"ok": True}


def session_get(scope: str, name: str) -> dict:
    session = ai_module_sessions.get_by_name(name)
    if session is None:
        return {"ok": False, "error": "neexistuje"}
    messages = ai_module_messages.list_for(session["id"])
    return {"ok": True, "name": name, "scope": session["scope"],
           "description": session["description"],
           "messages": [{"role": m["role"], "text": m["text"]}
                        for m in messages]}


def install(scope: str, name: str, overwrite: bool = False) -> dict:
    session = ai_module_sessions.get_by_name(name)
    if session is None:
        return {"ok": False, "error": "modul neexistuje"}

    history = ai_module_messages.list_for(session["id"])
    claude_md = agent.make_claude_md(name, session["description"], history)
    workspace.write_claude_md(name, claude_md)

    final_name = workspace.normalize_name(name)
    dest = workspace.copy_to_installed(name, final_name)

    module_catalog.upsert(final_name, "ai", ai_module_session_id=session["id"],
                          description_cs=session["description"])
    ai_module_sessions.set_scope(session["id"], "installed")
    workspace.delete_working_copy(name)

    return {"ok": True, "installedTo": dest}


# --------------------------------------------------------------------------- #
# Setup chat — configure a new instance of an installed module by talking to
# the agent. Deliberately in memory, not in ai_module_sessions: it is a
# throwaway conversation behind one modal, nothing outlives "Add widget"
# except the values the app stores on the instance itself. A daemon restart
# mid-chat just means the user starts the chat again.
# --------------------------------------------------------------------------- #
_CONFIG_RE = re.compile(r"<config>(.*?)</config>", re.S)
_CONFIG_OPEN_RE = re.compile(r"<config>.*\Z", re.S)
_MAX_CONFIG_CHATS = 20

_config_chats: dict = {}   # chatId -> {"entry", "claude_session_id", "busy"}
_config_lock = threading.Lock()


def strip_config_block(text: str) -> str:
    """Remove the machine-readable <config> block (or a dangling, unclosed
    start of one) from text shown to the user."""
    text = _CONFIG_RE.sub("", text or "")
    return _CONFIG_OPEN_RE.sub("", text).strip()


def parse_config_block(text: str):
    """The LAST <config>{...}</config> block in a reply, as
    {"values": dict, "ready": bool} — or None if missing/invalid."""
    blocks = _CONFIG_RE.findall(text or "")
    if not blocks:
        return None
    try:
        data = json.loads(blocks[-1].strip())
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("values"), dict):
        return None
    return {"values": data["values"], "ready": bool(data.get("ready"))}


def _config_turn(chat_id: str, prompt: str) -> None:
    chat = _config_chats.get(chat_id)
    if chat is None:
        return
    entry = chat["entry"]
    scope = constants.CONFIG_SCOPE
    full_text = []

    def on_event(event: dict) -> None:
        if event.get("type") == "text":
            full_text.append(event.get("text") or "")
            shown = strip_config_block(event.get("text"))
            if shown:
                _publish(scope, chat_id, {"type": "text", "text": shown})
            return
        if event.get("type") == "done":
            proposal = parse_config_block("".join(full_text))
            if proposal is not None:
                _publish(scope, chat_id, {"type": "config", **proposal})
        _publish(scope, chat_id, event)

    try:
        result = agent.run(
            scope, chat_id, prompt,
            workspace.installed_path(entry.get("module") or entry.get("type")),
            chat["claude_session_id"], on_event,
            system_prompt=prompts.config_system_prompt(entry),
            allowed_tools=agent.READ_ONLY_TOOLS)
        if result.get("claude_session_id"):
            chat["claude_session_id"] = result["claude_session_id"]
    finally:
        chat["busy"] = False


def _start_config_turn(chat_id: str, prompt: str) -> dict:
    with _config_lock:
        chat = _config_chats.get(chat_id)
        if chat is None:
            return {"ok": False, "error": "chat neexistuje", "status": 404}
        if chat["busy"]:
            return {"ok": False, "error": "agent ještě odpovídá", "status": 409}
        chat["busy"] = True
    threading.Thread(target=_config_turn, args=(chat_id, prompt),
                     daemon=True).start()
    return {"ok": True}


def config_start(chat_id: str, entry: dict) -> dict:
    """Open a setup chat for one catalog entry ({type, module, label,
    fields}) and run the agent's opening turn."""
    if not chat_id or not isinstance(entry, dict) or not entry.get("type"):
        return {"ok": False, "error": "chybí chatId nebo modul", "status": 400}
    with _config_lock:
        if chat_id not in _config_chats and \
                len(_config_chats) >= _MAX_CONFIG_CHATS:
            # forget the oldest abandoned chat (dicts keep insertion order)
            _config_chats.pop(next(iter(_config_chats)))
        _config_chats[chat_id] = {"entry": entry, "claude_session_id": None,
                                  "busy": False}
    return _start_config_turn(chat_id, prompts.CONFIG_START_PROMPT)


def config_message(chat_id: str, message: str) -> dict:
    if not message.strip():
        return {"ok": False, "error": "prázdná zpráva", "status": 400}
    return _start_config_turn(chat_id, message)


def config_end(chat_id: str) -> dict:
    with _config_lock:
        _config_chats.pop(chat_id, None)
    return {"ok": True}
