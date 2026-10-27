"""service.py — the orchestrator. agent.run() is mocked out everywhere: these
tests pin what service.py does with its result, not the Claude CLI itself.
"""

import os
import time

from data import ai_module_messages, ai_module_sessions, module_catalog
from features.ai_modules import agent, service, workspace


def _fake_run(assistant_text="ok", claude_session_id="sess-1", touched=None):
    def run(scope, name, prompt, cwd, claude_session_id_in=None, on_event=None):
        if on_event:
            on_event({"type": "text", "text": assistant_text})
        return {"assistant_text": assistant_text,
               "claude_session_id": claude_session_id,
               "touched_files": touched or []}
    return run


def test_draft_create_writes_the_working_copy_and_a_session(sandbox):
    result = service.draft_create("MMM-Foo", "a module")
    assert result["ok"] is True

    session = ai_module_sessions.get_by_name("MMM-Foo")
    assert session["scope"] == "draft"
    assert session["description"] == "a module"
    assert os.path.isfile(os.path.join(workspace.path_for("MMM-Foo"),
                                       "MMM-Foo.js"))


def test_list_drafts_reads_the_db_not_the_disk(sandbox):
    service.draft_create("MMM-Foo", "desc")
    assert service.list_drafts() == {
        "drafts": [{"name": "MMM-Foo", "description": "desc"}]}


def test_new_message_runs_the_agent_and_saves_both_sides(sandbox, monkeypatch):
    monkeypatch.setattr(agent, "run", _fake_run("the answer", "sess-xyz"))
    service.draft_create("MMM-Foo")

    result = service.new_message("draft", "MMM-Foo", "make it blue")
    assert result == {"ok": True}
    time.sleep(0.05)   # new_message runs the agent on a background thread

    session = ai_module_sessions.get_by_name("MMM-Foo")
    assert session["claude_session_id"] == "sess-xyz"
    msgs = ai_module_messages.list_for(session["id"])
    assert [(m["role"], m["text"]) for m in msgs] == [
        ("user", "make it blue"), ("assistant", "the answer")]


def test_new_message_on_an_unknown_module_fails(sandbox):
    result = service.new_message("draft", "MMM-Nope", "hi")
    assert result["ok"] is False


def test_new_message_rejects_an_empty_message(sandbox):
    service.draft_create("MMM-Foo")
    result = service.new_message("draft", "MMM-Foo", "   ")
    assert result["ok"] is False


def test_edit_open_on_an_existing_installed_module_flips_to_draft(
        sandbox, monkeypatch):
    monkeypatch.setattr(agent, "run", _fake_run())
    installed = os.path.join(sandbox.MM_MODULES_DIR, "MMM-Foo")
    os.makedirs(installed)
    with open(os.path.join(installed, "MMM-Foo.js"), "w") as f:
        f.write("// hi")
    sid = ai_module_sessions.create("installed", "MMM-Foo")

    result = service.edit_open("MMM-Foo")
    assert result["sessionId"] == sid
    assert ai_module_sessions.get(sid)["scope"] == "draft"
    assert os.path.isfile(os.path.join(workspace.path_for("MMM-Foo"),
                                       "MMM-Foo.js"))


def test_edit_open_on_a_never_opened_module_adopts_it(sandbox, monkeypatch):
    """First time opening a community module: a session is created and the
    agent's first turn is the adopt prompt, not a user message."""
    monkeypatch.setattr(agent, "run", _fake_run("this module shows weather"))
    installed = os.path.join(sandbox.MM_MODULES_DIR, "MMM-Weather")
    os.makedirs(installed)
    with open(os.path.join(installed, "MMM-Weather.js"), "w") as f:
        f.write("// weather")

    result = service.edit_open("MMM-Weather")
    time.sleep(0.05)

    session = ai_module_sessions.get(result["sessionId"])
    assert session["scope"] == "draft"
    msgs = ai_module_messages.list_for(session["id"])
    # Only the assistant's reply is stored — the adopt prompt itself is not
    # a user message.
    assert [(m["role"]) for m in msgs] == ["assistant"]


def test_session_get_returns_history(sandbox, monkeypatch):
    monkeypatch.setattr(agent, "run", _fake_run("hello there"))
    service.draft_create("MMM-Foo")
    service.new_message("draft", "MMM-Foo", "hi")
    time.sleep(0.05)

    result = service.session_get("draft", "MMM-Foo")
    assert result["ok"] is True
    assert [m["role"] for m in result["messages"]] == ["user", "assistant"]


def test_session_get_on_unknown_module_fails(sandbox):
    assert service.session_get("draft", "MMM-Nope")["ok"] is False


def test_install_moves_the_working_copy_and_writes_the_catalog(sandbox):
    service.draft_create("Weather Thing", "shows the weather")
    result = service.install("draft", "Weather Thing")

    assert result["ok"] is True
    final_name = "MMM-Weather-Thing"
    assert os.path.isdir(os.path.join(sandbox.MM_MODULES_DIR, final_name))
    assert not os.path.isdir(workspace.path_for("Weather Thing"))

    row = module_catalog.get_by_name(final_name)
    assert row["source"] == "ai"
    session = ai_module_sessions.get_by_name("Weather Thing")
    assert session["scope"] == "installed"
    assert row["ai_module_session_id"] == session["id"]


def test_install_writes_claude_md_into_the_installed_module(sandbox,
                                                             monkeypatch):
    monkeypatch.setattr(agent, "run", _fake_run("it shows the weather"))
    service.draft_create("MMM-Weather", "shows weather")
    service.new_message("draft", "MMM-Weather", "add a forecast")
    time.sleep(0.05)

    result = service.install("draft", "MMM-Weather")
    claude_md = os.path.join(result["installedTo"], "CLAUDE.md")
    assert os.path.isfile(claude_md)
    with open(claude_md, encoding="utf-8") as f:
        content = f.read()
    assert "add a forecast" in content


def test_install_on_an_unknown_module_fails(sandbox):
    assert service.install("draft", "MMM-Nope")["ok"] is False
