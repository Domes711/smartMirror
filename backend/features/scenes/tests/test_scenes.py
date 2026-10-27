"""Scenes: SQLite round-trip, FK cascades, validation, codegen."""

import json

import pytest


@pytest.fixture
def scenes(sandbox):
    from features.modules import catalog
    from features.scenes import codegen, store
    catalog.seed_builtins()
    return store, codegen, catalog, sandbox


DOC = {
    "instances": [
        {"id": "clock", "type": "clock", "values": {}},
        {"id": "news1", "type": "newsfeed",
         "values": {"url": "https://x/rss", "title": "Zprávy"}},
    ],
    "defaults": {
        "default": [{"id": "clock", "position": "top_left"}],
        "tata": [{"id": "news1", "position": "bottom_bar"}],
    },
    "windows": {
        "tata": {"rano": {"from": "0 6 * * *", "to": "0 9 * * *",
                          "label": "Ráno",
                          "layout": [{"id": "clock", "position": "top_center"},
                                     {"id": "news1", "position": "lower_third"}]}},
    },
}


def test_save_load_round_trip(scenes):
    store, _cg, catalog, _p = scenes
    assert store.validate(DOC, catalog.by_type()) is None
    store.save(DOC)
    back = store.load()
    # Instances carry `profile` and `placement` on top of what the editor
    # sends (a save without a profile is adopted by `default`), so compare the
    # fields the document actually specified.
    assert [{k: i[k] for k in ("id", "type", "values")}
            for i in back["instances"]] == DOC["instances"]
    assert all(i["profile"] == "default" for i in back["instances"])
    assert back["windows"] == DOC["windows"]
    assert back["defaults"]["tata"] == DOC["defaults"]["tata"]


def test_layout_entry_order_is_preserved(scenes):
    """Placement order inside a window matters — it is a `sort` column, not
    whatever order SQLite happens to return rows in."""
    store, _cg, _cat, _p = scenes
    store.save(DOC)
    layout = store.load()["windows"]["tata"]["rano"]["layout"]
    assert [e["id"] for e in layout] == ["clock", "news1"]


def test_save_is_a_full_replace(scenes):
    store, _cg, _cat, _p = scenes
    store.save(DOC)
    store.save({"instances": [{"id": "clock", "type": "clock", "values": {}}],
                "defaults": {}, "windows": {}})
    back = store.load()
    assert [i["id"] for i in back["instances"]] == ["clock"]
    assert back["windows"] == {}


def test_removing_a_type_cascades_into_layouts(scenes):
    """Uninstalling a module must take its placements with it — the JSON
    store needed a manual sweep here and could leave orphans behind."""
    store, _cg, _cat, _p = scenes
    store.save(DOC)
    assert store.remove_instances_of_type("newsfeed") == {"news1"}
    back = store.load()
    assert [i["id"] for i in back["instances"]] == ["clock"]
    assert back["defaults"]["tata"] == []
    assert back["windows"]["tata"]["rano"]["layout"] == [
        {"id": "clock", "position": "top_center"}]


def test_removing_a_profile_cascades(scenes):
    store, _cg, _cat, _p = scenes
    store.save(DOC)
    store.remove_profile("tata")
    back = store.load()
    assert "tata" not in back["windows"]
    assert "tata" not in back["defaults"]


def test_default_profile_cannot_be_removed(scenes):
    store, _cg, _cat, _p = scenes
    with pytest.raises(ValueError):
        store.remove_profile("default")


def test_dangling_layout_reference_is_dropped(scenes):
    """A layout entry pointing at an instance that is not in the document
    must not become a row — the FK would reject it at commit time."""
    store, _cg, _cat, _p = scenes
    store.save({"instances": [{"id": "clock", "type": "clock", "values": {}}],
                "defaults": {"default": [{"id": "ghost", "position": "top_left"},
                                         {"id": "clock", "position": "top_bar"}]},
                "windows": {}})
    assert store.load()["defaults"]["default"] == [
        {"id": "clock", "position": "top_bar"}]


@pytest.mark.parametrize("bad, fragment", [
    ({"instances": [{"type": "clock"}], "defaults": {}, "windows": {}},
     "without id"),
    ({"instances": [{"id": "a", "type": "clock"}, {"id": "a", "type": "clock"}],
      "defaults": {}, "windows": {}}, "duplicate"),
    ({"instances": [{"id": "a", "type": "nope"}], "defaults": {}, "windows": {}},
     "unknown module type"),
    ({"instances": [{"id": "w", "type": "weather", "values": {}}],
      "defaults": {}, "windows": {}}, "povinné pole"),
    ({"instances": [], "defaults": {"default": [{"id": "a", "position": "moon"}]},
      "windows": {}}, "neplatná pozice"),
    ({"instances": [], "defaults": {},
      "windows": {"default": {"w": {"from": "", "to": "", "layout": []}}}},
     "chybí from/to"),
])
def test_validation_rejects(scenes, bad, fragment):
    _s, _cg, catalog, _p = scenes
    from features.scenes import store
    err = store.validate(bad, catalog.by_type())
    assert err and fragment in err


def test_pages_js_is_generated_and_parses(scenes):
    store, codegen, catalog, paths = scenes
    store.save(DOC)
    codegen.generate(store.load(), catalog.by_type())
    text = open(paths.PAGES_PATH).read()
    assert text.startswith("/* AUTO-GENERATED")
    body = json.loads(text.split("module.exports = ", 1)[1].rstrip().rstrip(";"))
    assert body["tata"]["rano"]["from"] == "0 6 * * *"
    # `label` is editor-only metadata and must not leak into pages.js.
    assert "label" not in body["tata"]["rano"]


@pytest.mark.parametrize("reserved", ["defaults", "globalLayout"])
def test_a_profile_may_not_shadow_a_reserved_pages_key(scenes, reserved):
    """pages.js keeps `defaults`/`globalLayout` for itself. A profile with
    one of those names would overwrite the real block, so it is rejected at
    validation instead of being silently dropped during codegen."""
    _s, _cg, catalog, _p = scenes
    from features.scenes import store
    doc = {"instances": [], "defaults": {},
           "windows": {reserved: {"w": {"from": "0 0 * * *",
                                        "to": "1 0 * * *", "layout": []}}}}
    err = store.validate(doc, catalog.by_type())
    assert err and "vyhrazené" in err


def test_modules_js_is_generated_and_parses(scenes):
    """The core require()s this file, so it must be valid JS and carry the
    instances the DB holds."""
    import json
    import subprocess
    store, codegen, catalog, paths = scenes
    store.save(DOC)
    codegen.generate(store.load(), catalog.by_type())

    out = subprocess.run(
        ["node", "-e",
         "process.stdout.write(JSON.stringify(require(process.argv[1])))",
         paths.MODULES_JS_PATH],
        capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    mods = json.loads(out.stdout)
    assert {m["id"] for m in mods} == {"clock", "news1"}
    # Every instance carries what the core needs to build a module.
    for m in mods:
        assert m["module"] and "config" in m and m["placement"] == "region"


def test_generate_is_idempotent(scenes):
    store, codegen, catalog, paths = scenes
    store.save(DOC)
    codegen.generate(store.load(), catalog.by_type())
    once = open(paths.MODULES_JS_PATH).read()
    codegen.generate(store.load(), catalog.by_type())
    assert open(paths.MODULES_JS_PATH).read() == once


def test_generate_does_not_touch_config_js(scenes):
    """Module instances live in the DB. config.js is hand-maintained and must
    be left exactly as the user wrote it."""
    store, codegen, catalog, paths = scenes
    before = open(paths.CONFIG_JS_PATH).read()
    store.save(DOC)
    codegen.generate(store.load(), catalog.by_type())
    assert open(paths.CONFIG_JS_PATH).read() == before


def test_previous_module_ids_reads_the_generated_file(scenes):
    """apply_layout uses this to decide hot-load vs plain reload."""
    store, codegen, catalog, _paths = scenes
    assert codegen.previous_module_ids() == set()
    store.save(DOC)
    codegen.generate(store.load(), catalog.by_type())
    assert codegen.previous_module_ids() == {"clock", "news1"}


def test_module_config_shapes(scenes):
    from features.scenes.codegen import module_config
    assert module_config("clock", {"x": 1}) == {}
    assert module_config("newsfeed", {"url": "u"})["feeds"][0]["title"] == "News"
    assert module_config("MMM-GoogleCalendar", {"calendarID": "c"})[
        "calendars"][0]["calendarID"] == "c"
    # Unknown types pass their values through flat.
    assert module_config("MMM-Whatever", {"a": 1}) == {"a": 1}
    # The GTFS URL is baked in so a map-picked stop needs no URL from the user.
    assert "arcgis.com" in module_config("MMM-Brno-Transit", {"stopName": "X"})["gtfsUrl"]


