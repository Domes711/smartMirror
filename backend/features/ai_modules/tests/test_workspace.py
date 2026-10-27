"""workspace.py — working-copy file I/O. Pure filesystem operations, no DB."""

import io
import os
import zipfile

import pytest

from features.ai_modules import workspace


def test_write_files_creates_the_working_copy(sandbox):
    workspace.write_files("MMM-Foo", {"MMM-Foo.js": "// hi"})
    assert os.path.isfile(os.path.join(workspace.path_for("MMM-Foo"),
                                       "MMM-Foo.js"))


def test_write_claude_md(sandbox):
    workspace.write_files("MMM-Foo", {"MMM-Foo.js": "// hi"})
    workspace.write_claude_md("MMM-Foo", "# MMM-Foo\n")
    p = os.path.join(workspace.path_for("MMM-Foo"), workspace.CLAUDE_MD)
    with open(p, encoding="utf-8") as f:
        assert f.read() == "# MMM-Foo\n"


def test_copy_from_installed(sandbox):
    installed = os.path.join(sandbox.MM_MODULES_DIR, "MMM-Foo")
    os.makedirs(installed)
    with open(os.path.join(installed, "MMM-Foo.js"), "w") as f:
        f.write("// live")

    workspace.copy_from_installed("MMM-Foo")

    with open(os.path.join(workspace.path_for("MMM-Foo"), "MMM-Foo.js")) as f:
        assert f.read() == "// live"
    # the original must be untouched
    with open(os.path.join(installed, "MMM-Foo.js")) as f:
        assert f.read() == "// live"


def test_copy_to_installed_overwrites_the_destination(sandbox):
    installed = os.path.join(sandbox.MM_MODULES_DIR, "MMM-Foo")
    os.makedirs(installed)
    with open(os.path.join(installed, "MMM-Foo.js"), "w") as f:
        f.write("// old")

    workspace.write_files("MMM-Foo", {"MMM-Foo.js": "// new"})
    dest = workspace.copy_to_installed("MMM-Foo", "MMM-Foo")

    with open(os.path.join(dest, "MMM-Foo.js")) as f:
        assert f.read() == "// new"


def test_delete_working_copy(sandbox):
    workspace.write_files("MMM-Foo", {"MMM-Foo.js": "// hi"})
    workspace.delete_working_copy("MMM-Foo")
    assert not os.path.isdir(workspace.path_for("MMM-Foo"))


def test_delete_working_copy_on_a_missing_dir_is_a_noop(sandbox):
    workspace.delete_working_copy("MMM-Never-Existed")   # must not raise


@pytest.mark.parametrize("raw, expected", [
    ("Weather Plus", "MMM-Weather-Plus"),
    ("weather plus", "MMM-weather-plus"),
    ("MMM-WeatherPlus", "MMM-WeatherPlus"),
    ("Předpověď počasí", "MMM-Predpoved-pocasi"),
])
def test_normalize_name_strips_spaces_and_diacritics(raw, expected):
    assert workspace.normalize_name(raw) == expected


def test_normalize_name_refuses_an_empty_result():
    with pytest.raises(ValueError):
        workspace.normalize_name("   ")


def test_zip_working_copy_contains_every_file(sandbox):
    workspace.write_files("MMM-Foo", {"MMM-Foo.js": "// hi",
                                     "MMM-Foo.css": "/* style */"})
    data = workspace.zip_working_copy("MMM-Foo")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert set(zf.namelist()) == {"MMM-Foo.js", "MMM-Foo.css"}
