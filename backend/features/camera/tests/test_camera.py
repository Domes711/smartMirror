"""Camera: profile/photo storage, name validation, dataset reconciliation."""

import os

import pytest


@pytest.fixture
def cam(sandbox):
    from features.camera import profiles
    return profiles, sandbox


def _write_photo(paths, person, fname, data=b"\xff\xd8jpg"):
    d = os.path.join(paths.DATASET_DIR, person)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, fname), "wb") as f:
        f.write(data)


def test_default_profile_always_exists(cam):
    profiles, _p = cam
    names = [p["name"] for p in profiles.list_all()]
    assert names[0] == "default"
    assert profiles.list_all()[0]["is_default"] is True


def test_a_profile_can_exist_before_its_first_photo(cam):
    """The old code derived profiles from "a dataset dir with a jpg in it",
    so an enrolled-but-not-yet-photographed person did not exist."""
    profiles, _p = cam
    profiles.ensure("tata")
    entry = next(p for p in profiles.list_all() if p["name"] == "tata")
    assert entry["count"] == 0 and entry["sample"] is None


def test_photos_on_disk_are_indexed(cam):
    profiles, paths = cam
    _write_photo(paths, "tata", "1.jpg")
    _write_photo(paths, "tata", "2.jpg")
    entry = next(p for p in profiles.list_all() if p["name"] == "tata")
    assert entry["count"] == 2
    assert entry["sample"] in ("1.jpg", "2.jpg")


def test_photos_removed_outside_the_api_are_forgotten(cam):
    """Someone restoring a backup over dataset/ must not leave the listing
    reporting photos the encoder will never see."""
    profiles, paths = cam
    _write_photo(paths, "tata", "1.jpg")
    assert profiles.list_all()
    os.remove(os.path.join(paths.DATASET_DIR, "tata", "1.jpg"))
    entry = next(p for p in profiles.list_all() if p["name"] == "tata")
    assert entry["count"] == 0


def test_photo_listing_sorts_numerically(cam):
    profiles, paths = cam
    for n in (1, 2, 10, 3):
        _write_photo(paths, "tata", f"{n}.jpg")
    assert profiles.list_photos("tata") == ["1.jpg", "2.jpg", "3.jpg", "10.jpg"]


def test_next_filename_continues_the_sequence(cam):
    profiles, paths = cam
    _write_photo(paths, "tata", "1.jpg")
    _write_photo(paths, "tata", "9.jpg")
    assert profiles.next_filename("tata") == "10.jpg"
    assert profiles.next_filename("nobody") == "1.jpg"


def test_delete_photo_removes_file_and_row(cam):
    profiles, paths = cam
    _write_photo(paths, "tata", "1.jpg")
    profiles.list_all()                       # index it
    profiles.delete_photo("tata", "1.jpg")
    assert not os.path.exists(os.path.join(paths.DATASET_DIR, "tata", "1.jpg"))
    assert profiles.list_photos("tata") == []


def test_removing_a_profile_deletes_its_dataset(cam, monkeypatch):
    profiles, paths = cam
    _write_photo(paths, "tata", "1.jpg")
    profiles.list_all()
    monkeypatch.setattr(profiles, "rebuild_encodings", lambda: {"ok": True})
    result = profiles.remove("tata")
    assert result["removed"] == "tata"
    assert not os.path.isdir(os.path.join(paths.DATASET_DIR, "tata"))
    assert "tata" not in [p["name"] for p in profiles.list_all()]


def test_default_profile_cannot_be_removed(cam):
    profiles, _p = cam
    with pytest.raises(ValueError):
        profiles.remove("default")


@pytest.mark.parametrize("bad", ["../etc", "a/b", "", "x" * 41, "há!"])
def test_profile_names_are_validated(cam, bad):
    """The name becomes a directory under dataset/, so traversal and
    oversize names are rejected before any filesystem call."""
    profiles, _p = cam
    with pytest.raises(ValueError):
        profiles.person_dir(bad)


@pytest.mark.parametrize("bad", ["../x.jpg", "a/b.jpg", "evil.sh", "no-ext"])
def test_photo_filenames_are_validated(cam, bad):
    profiles, _p = cam
    with pytest.raises(ValueError):
        profiles.photo_path("tata", bad)


def test_rebuild_writes_empty_encodings_for_an_empty_dataset(cam):
    """encode_faces.py errors out on an empty dataset, so the empty case
    writes the pickle directly instead of shelling out and failing."""
    import pickle
    profiles, paths = cam
    assert profiles.rebuild_encodings()["ok"] is True
    with open(paths.ENCODINGS_PATH, "rb") as f:
        assert pickle.load(f) == {"encodings": [], "names": []}


def test_supervisor_rejects_an_unknown_mode(sandbox):
    from features.camera.supervisor import Supervisor
    sup = Supervisor()
    with pytest.raises(ValueError):
        sup.apply_mode("nonsense")


def test_supervisor_rejects_an_unsupported_resolution(sandbox):
    from features.camera.supervisor import Supervisor
    sup = Supervisor()
    with pytest.raises(ValueError):
        sup.set_resolution(1234, 567)


def test_supervisor_health_shape(sandbox):
    from features.camera.supervisor import DEFAULT_MODE, MODES, Supervisor
    h = Supervisor().health()
    assert h["mode"] == DEFAULT_MODE
    assert set(h["modes"]) == set(MODES)
    assert h["camera_open"] is False and h["fps"] == 0.0


def test_mode_persists_across_restarts(sandbox):
    from features.camera.supervisor import Supervisor
    sup = Supervisor()
    sup.save_mode("test_gesture")
    assert Supervisor().load_mode() == "test_gesture"


def test_an_unknown_persisted_mode_falls_back_to_the_default(sandbox):
    from features.camera.supervisor import DEFAULT_MODE, STATE_FILE, Supervisor
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        f.write("garbage")
    assert Supervisor().load_mode() == DEFAULT_MODE
