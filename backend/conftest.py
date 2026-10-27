"""Test fixtures: every test gets its own throwaway DB + var dir.

`shared.paths` resolves every location from the environment on each access
(see its module-level `__getattr__`), so setting the env vars here is enough
— no module needs reloading, and no feature can have frozen a stale path at
import time.
"""

import pytest


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A fresh var dir, DB and fake MagicMirror tree for one test."""
    mm = tmp_path / "MagicMirror" / "config"
    mm.mkdir(parents=True)
    (mm / "config.js").write_text(
        'let config = { language: "cs", modules: [] };\n')
    (tmp_path / "MagicMirror" / "modules").mkdir()

    monkeypatch.setenv("MIRROR_VAR_DIR", str(tmp_path / "var"))
    monkeypatch.setenv("MIRROR_DB", str(tmp_path / "var" / "test.db"))
    monkeypatch.setenv("MAGICMIRROR_DIR", str(tmp_path / "MagicMirror"))
    # ai_modules working copies live inside the feature folder, not var/ —
    # still redirected per test so nothing ever touches the real one.
    monkeypatch.setenv("MIRROR_AI_MODULES_WORKSPACE",
                      str(tmp_path / "ai-modules-workspace"))

    from shared import db, paths
    # A fresh connection per test: the thread-local one still points at the
    # previous test's DB file.
    db._local.__dict__.clear()
    paths.ensure_var_dirs()
    db.init()

    yield paths

    db._local.__dict__.clear()
