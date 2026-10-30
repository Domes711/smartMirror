"""store_import.py — MMM-store's mm-store.json files -> the module catalog."""

import json
import os

from data import module_catalog, module_fields, module_screenshots, module_tags
from features.modules import catalog, store_import

META = {
    "name": {"en": "Weather One Call", "cs": "Počasí One Call"},
    "description": {"en": "Forecasts.", "cs": "Předpověď."},
    "screenshots": ["screenshots/normal.png", "../../escape.png"],
    "scope": "global",
    "tags": ["weather", "forecast"],
    "wizard": [
        {"key": "apikey", "label": {"en": "API key", "cs": "API klíč"},
         "type": "password", "required": True,
         "help": {"en": "Sign up.", "cs": "Zaregistruj se."}},
        {"key": "units", "label": {"en": "Units", "cs": "Jednotky"},
         "type": "select", "required": False, "help": "",
         "options": ["metric", {"value": "imperial",
                                "label": {"en": "Imperial", "cs": "Imperiální"}}],
         "default": "metric"},
    ],
}


def _store(tmp_path, modules):
    root = tmp_path / "MMM-store"
    for name, meta in modules.items():
        d = root / "modules" / name
        (d / "screenshots").mkdir(parents=True)
        (d / "screenshots" / "normal.png").write_bytes(b"png")
        (d / "mm-store.json").write_text(json.dumps(meta), encoding="utf-8")
    return str(root)


UPSTREAM = {"MMM-OneCallWeather": {
    "url": "https://github.com/x/MMM-OneCallWeather", "maintainer": "x",
    "stars": 15, "category": "Weather", "image": "w.webp"}}


def test_import_writes_catalog_fields_tags_and_screenshots(sandbox, tmp_path):
    src = _store(tmp_path, {"MMM-OneCallWeather": META})
    stats = store_import.import_store(src, UPSTREAM)
    assert stats["imported"] == 1

    row = module_catalog.get_by_name("MMM-OneCallWeather")
    assert row["source"] == "community"
    assert row["label_cs"] == "Počasí One Call"
    assert row["label_en"] == "Weather One Call"
    assert row["repo_url"] == "https://github.com/x/MMM-OneCallWeather"
    assert row["stars"] == 15

    fields = module_fields.for_module(row["id"])
    assert [(f["key"], f["label_cs"], f["required"], f["field_type"])
            for f in fields] == [("apikey", "API klíč", True, "password"),
                                 ("units", "Jednotky", False, "select")]
    assert fields[0]["help"] == "Zaregistruj se."
    assert fields[1]["options"] == [{"value": "metric", "label": "metric"},
                                    {"value": "imperial", "label": "Imperiální"}]
    assert fields[1]["placeholder"] == "metric"

    assert sorted(module_tags.for_module(row["id"])) == ["forecast", "weather"]
    # the ../ path is ignored, the real one copied into module-assets
    assert module_screenshots.paths_for(row["id"]) == [
        "MMM-OneCallWeather/normal.png"]
    assert os.path.isfile(os.path.join(
        sandbox.MODULE_ASSETS_DIR, "MMM-OneCallWeather", "normal.png"))


def test_rerun_without_upstream_keeps_the_repo_url(sandbox, tmp_path):
    src = _store(tmp_path, {"MMM-OneCallWeather": META})
    store_import.import_store(src, UPSTREAM)
    store_import.import_store(src, {})
    row = module_catalog.get_by_name("MMM-OneCallWeather")
    assert row["repo_url"] == "https://github.com/x/MMM-OneCallWeather"


def test_own_modules_are_left_alone_and_installed_stays_installed(sandbox, tmp_path):
    catalog.seed_builtins()
    module_catalog.mark_installed("MMM-OneCallWeather")
    src = _store(tmp_path, {"MMM-OneCallWeather": META, "MMM-Spending": META})

    stats = store_import.import_store(src, UPSTREAM)
    assert stats["skipped_own"] == 1
    assert module_catalog.get_by_name("MMM-Spending")["label_cs"] == "Útraty"
    weather = module_catalog.get_by_name("MMM-OneCallWeather")
    assert weather["source"] == "installed"
    assert weather["label_cs"] == "Počasí One Call"


def test_community_rows_missing_from_the_store_are_pruned(sandbox, tmp_path):
    store_import.import_store(_store(tmp_path, {"MMM-OneCallWeather": META}),
                              UPSTREAM)
    module_catalog.upsert("MMM-Gone", "community")
    empty = tmp_path / "empty"
    (empty / "modules").mkdir(parents=True)

    assert store_import.import_store(str(empty), {}, prune=False)["pruned"] == 0
    assert store_import.import_store(str(empty), {})["pruned"] == 2
    assert module_catalog.get_by_name("MMM-Gone") is None
