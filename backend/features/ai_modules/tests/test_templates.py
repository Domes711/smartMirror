"""templates.py — scaffold file generation. Pure string generation, no I/O."""

import json

from features.ai_modules import templates


def test_scaffold_produces_the_four_house_files():
    files = templates.scaffold("MMM-Demo", "popis")
    assert set(files) == {"MMM-Demo.js", "MMM-Demo.css", "node_helper.js",
                          "package.json"}


def test_module_js_registers_under_the_given_name():
    js = templates.module_js("MMM-Demo", "popis")
    assert 'Module.register("MMM-Demo"' in js
    assert "getStyles" in js and "MMM-Demo.css" in js


def test_package_json_is_private_and_named():
    pkg = json.loads(templates.package_json("MMM-Demo", "popis"))
    assert pkg["private"] is True
    assert pkg["main"] == "MMM-Demo.js"
    assert pkg["description"] == "popis"


def test_package_json_falls_back_to_a_generic_description():
    pkg = json.loads(templates.package_json("MMM-Demo"))
    assert "MMM-Demo" in pkg["description"]


def test_node_helper_js_is_scoped_to_the_module_name():
    helper = templates.node_helper_js("MMM-Demo")
    assert "NodeHelper.create" in helper
    assert "MMM_DEMO_DATA" in helper
