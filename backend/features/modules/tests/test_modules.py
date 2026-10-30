"""Modules: catalog storage, provenance, install guards, name normalisation."""

import json
import os

import pytest


@pytest.fixture
def mods(sandbox):
    from features.modules import catalog
    catalog.seed_builtins()
    return catalog, sandbox


def test_builtins_are_placeable(mods):
    catalog, _p = mods
    by_type = catalog.by_type()
    assert "clock" in by_type and "MMM-Brno-Transit" in by_type
    assert by_type["MMM-Brno-Transit"]["label"] == "MHD Brno"


def test_seed_builtins_is_idempotent(mods):
    catalog, _p = mods
    before = catalog.placeable()
    catalog.seed_builtins()
    assert catalog.placeable() == before


def test_required_fields_survive_the_round_trip(mods):
    catalog, _p = mods
    fields = {f["key"]: f for f in catalog.by_type()["weather"]["fields"]}
    assert fields["apiKey"]["required"] is True
    assert fields["lat"]["required"] is True


def test_field_options_and_help_round_trip(mods):
    catalog, _p = mods
    catalog.upsert({"type": "MMM-Opt", "module": "MMM-Opt", "label_cs": "Opt",
                    "fields": [{"key": "k", "label": "K", "type": "select",
                                "help": "nápověda", "placeholder": "ph",
                                "options": [{"value": "a", "label": "A"}]}]},
                   "custom")
    f = catalog.by_type()["MMM-Opt"]["fields"][0]
    assert f["options"] == [{"value": "a", "label": "A"}]
    assert f["help"] == "nápověda" and f["placeholder"] == "ph"


def test_community_entries_are_not_placeable(mods):
    """Browsing the store must not let you place something that is not on
    disk yet — only builtin/installed/custom are placeable."""
    catalog, _p = mods
    catalog.upsert({"type": "MMM-Remote", "module": "MMM-Remote",
                    "url": "https://github.com/x/MMM-Remote"}, "community")
    assert "MMM-Remote" not in catalog.by_type()
    assert any(e["id"] == "MMM-Remote"
               for e in catalog.full_catalog()["community"])


def test_mark_installed_promotes_a_community_row(mods):
    catalog, _p = mods
    catalog.upsert({"type": "MMM-Remote", "module": "MMM-Remote",
                    "url": "https://github.com/x/MMM-Remote"}, "community")
    catalog.mark_installed("MMM-Remote")
    assert "MMM-Remote" in catalog.by_type()
    assert catalog.lookup("MMM-Remote")["installed_at"] is not None


def test_mark_installed_creates_a_row_for_a_side_loaded_module(mods):
    catalog, _p = mods
    catalog.mark_installed("MMM-SideLoaded", "https://github.com/x/y")
    row = catalog.lookup("MMM-SideLoaded")
    assert row["source"] == "installed" and row["repo_url"].endswith("/y")


def test_remove_drops_the_row_and_its_children(mods):
    from shared import db
    catalog, _p = mods
    module_id = catalog.upsert(
        {"type": "MMM-Gone", "module": "MMM-Gone",
         "fields": [{"key": "a", "label": "A"}],
         "tags": ["x"], "screenshots": ["MMM-Gone/a.png"],
         "images": ["https://example.test/a.png"]}, "custom")
    catalog.remove("MMM-Gone")
    assert catalog.lookup("MMM-Gone") is None
    # Children hang off the catalog id, so the cascade reaches all four.
    for table in ("module_fields", "module_screenshots", "module_tags",
                  "module_images"):
        assert db.query(
            f"SELECT 1 FROM {table} WHERE module_id = ?", (module_id,)) == []


def test_upsert_without_fields_key_preserves_existing_fields(mods):
    """A partial update (e.g. only new screenshots) must not wipe the config
    wizard — `fields=None` means "not supplied", not "empty"."""
    catalog, _p = mods
    catalog.upsert({"type": "MMM-Keep", "module": "MMM-Keep",
                    "fields": [{"key": "a", "label": "A", "required": True}]},
                   "custom")
    catalog.upsert({"type": "MMM-Keep", "screenshots": ["MMM-Keep/s.png"]},
                   "custom")
    assert len(catalog.by_type()["MMM-Keep"]["fields"]) == 1


def test_screenshots_become_asset_urls(mods):
    catalog, _p = mods
    catalog.upsert({"type": "MMM-Shot", "module": "MMM-Shot",
                    "screenshots": ["MMM-Shot/one.png"]}, "custom")
    entry = next(e for e in catalog.full_catalog()["own"]
                 if e["id"] == "MMM-Shot")
    assert entry["image"] == "/module-assets/MMM-Shot/one.png"


def test_a_local_screenshot_beats_the_upstream_image(mods):
    catalog, _p = mods
    catalog.upsert({"type": "MMM-Both", "module": "MMM-Both",
                    "remote_image": "https://up/stream.png",
                    "screenshots": ["MMM-Both/local.png"]}, "community")
    entry = next(e for e in catalog.full_catalog()["community"]
                 if e["id"] == "MMM-Both")
    assert entry["image"] == "/module-assets/MMM-Both/local.png"


def test_install_rejects_an_unknown_module(mods):
    from features.modules import install
    with pytest.raises(ValueError, match="katalogu"):
        install.install("MMM-NotThere")


def test_install_rejects_a_non_forge_url(mods):
    """The repo URL comes from catalog data, so it is validated before it is
    handed to `git clone` — only the two forges the catalog lists."""
    catalog, _p = mods
    from features.modules import install
    catalog.upsert({"type": "MMM-Evil", "module": "MMM-Evil",
                    "url": "file:///etc/passwd"}, "community")
    with pytest.raises(ValueError, match="nepodporovaný zdroj"):
        install.install("MMM-Evil")


def test_install_rejects_a_bad_module_name(mods):
    catalog, _p = mods
    from features.modules import install
    catalog.upsert({"type": "../escape", "module": "../escape",
                    "url": "https://github.com/x/y"}, "community")
    with pytest.raises(ValueError, match="neplatné jméno"):
        install.install("../escape")


def test_install_status_is_idle_for_an_unknown_job(mods):
    from features.modules import install
    assert install.status("MMM-Nope") == {"phase": "idle", "percent": 0,
                                          "done": False}


def test_uninstall_rejects_a_bad_name(mods):
    from features.modules import install
    with pytest.raises(ValueError):
        install.uninstall("../../etc")


def test_readme_prefers_the_local_file(mods, sandbox):
    from features.modules import install
    d = os.path.join(sandbox.MM_MODULES_DIR, "MMM-Local")
    os.makedirs(d)
    with open(os.path.join(d, "README.md"), "w") as f:
        f.write("# local readme")
    assert install.readme("MMM-Local")["markdown"] == "# local readme"


@pytest.mark.parametrize("url, host", [
    ("https://github.com/a/b", "raw.githubusercontent.com"),
    ("https://github.com/a/b.git", "raw.githubusercontent.com"),
    ("https://gitlab.com/a/b", "gitlab.com"),
])
def test_raw_readme_urls(sandbox, url, host):
    from features.modules.install import _raw_readme_urls
    urls, base = _raw_readme_urls(url)
    assert urls and all(host in u for u in urls)
    assert base.endswith("/")






def test_install_accepts_community_names_without_the_mmm_prefix(mods, monkeypatch):
    catalog, _p = mods
    from features.modules import install
    monkeypatch.setattr(install, "_worker", lambda *a: None)
    catalog.upsert({"type": "DWD-RealtimeIrishRail",
                    "module": "DWD-RealtimeIrishRail",
                    "url": "https://github.com/x/DWD-RealtimeIrishRail"},
                   "community")
    assert install.install("DWD-RealtimeIrishRail")["started"] is True


def test_install_without_a_repo_url_says_so(mods):
    catalog, _p = mods
    from features.modules import install
    catalog.upsert({"type": "MMM-NoRepo", "module": "MMM-NoRepo"}, "community")
    with pytest.raises(ValueError, match="nemá repozitář"):
        install.install("MMM-NoRepo")
