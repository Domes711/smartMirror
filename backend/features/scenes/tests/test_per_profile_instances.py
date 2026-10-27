"""Per-profile module instances (migration 002).

The model these tests pin down:

  module_catalog   what is *available* — one row per cloned repo/type
  scene_instances  what is *configured* — one row per (type, profile), with
                   that profile's own field values
  scene_*_entries  where and when it shows — untouched by this change

The workflow: installing clones the repo and configures nothing. Adding a
module to a scene is what creates an instance, owned by the profile it was
added under. A second profile adding the same module does not re-clone — it
gets its own instance with its own config.
"""

import pytest


@pytest.fixture
def scenes(sandbox):
    from features.modules import catalog
    from features.scenes import store
    catalog.seed_builtins()
    return store


def _doc(instances, defaults=None):
    return {"instances": instances, "defaults": defaults or {}, "windows": {}}


def test_two_profiles_configure_the_same_module_independently(scenes):
    """The headline case: a personalised module (mail) needs separate
    credentials per person, so each profile owns its own instance."""
    scenes.save(_doc([
        {"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
         "values": {"user": "domes@example.com"}},
        {"id": "mail-tomas", "type": "MMM-Mail", "profile": "tomas",
         "values": {"user": "tomas@example.com"}},
    ]))
    by_id = {i["id"]: i for i in scenes.load()["instances"]}
    assert by_id["mail-domes"]["values"]["user"] == "domes@example.com"
    assert by_id["mail-tomas"]["values"]["user"] == "tomas@example.com"
    assert by_id["mail-domes"]["profile"] == "domes"
    assert by_id["mail-tomas"]["profile"] == "tomas"


def test_saving_one_profile_does_not_wipe_another_profiles_instances(scenes):
    """`save()` used to DELETE the whole instances table. With per-profile
    instances that would destroy everyone else's configuration — including
    credentials — on any single-profile save."""
    scenes.save(_doc([
        {"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
         "values": {"user": "domes@example.com"}},
    ]))
    # A later save carrying only Tomas's instance must leave Domes's alone.
    scenes.save(_doc([
        {"id": "mail-tomas", "type": "MMM-Mail", "profile": "tomas",
         "values": {"user": "tomas@example.com"}},
    ]))
    ids = {i["id"] for i in scenes.load()["instances"]}
    assert ids == {"mail-domes", "mail-tomas"}


def test_resaving_a_profile_replaces_only_its_own_instances(scenes):
    scenes.save(_doc([
        {"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
         "values": {"user": "old@example.com"}},
        {"id": "clock-tomas", "type": "clock", "profile": "tomas",
         "values": {}},
    ]))
    scenes.save(_doc([
        {"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
         "values": {"user": "new@example.com"}},
    ]))
    by_id = {i["id"]: i for i in scenes.load()["instances"]}
    assert by_id["mail-domes"]["values"]["user"] == "new@example.com"
    assert "clock-tomas" in by_id          # untouched profile survives


def test_one_instance_per_type_per_profile(scenes):
    """Deliberate scope limit: two mailboxes for one person is not supported
    yet, and the schema says so rather than leaving it to the UI."""
    import sqlite3
    from shared import db
    scenes.save(_doc([
        {"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
         "values": {}},
    ]))
    from data import module_catalog
    module_id = module_catalog.id_for("MMM-Mail")
    with pytest.raises(sqlite3.IntegrityError):
        with db.tx() as conn:
            conn.execute(
                "INSERT INTO scene_instances(id, module_id, profile) "
                "VALUES ('mail-domes-2', ?, 'domes')", (module_id,))


def test_deleting_a_profile_removes_its_instances_and_placements(scenes):
    scenes.save(_doc(
        [{"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
          "values": {}}],
        defaults={"domes": [{"id": "mail-domes", "position": "top_left"}]},
    ))
    scenes.remove_profile("domes")
    back = scenes.load()
    assert [i for i in back["instances"] if i["profile"] == "domes"] == []
    assert back["defaults"].get("domes", []) == []


def test_instance_without_a_profile_is_adopted_by_default(scenes):
    """Back-compat: the editor may still send an instance with no profile."""
    scenes.save(_doc([{"id": "clock", "type": "clock", "values": {}}]))
    assert scenes.load()["instances"][0]["profile"] == "default"


def test_placement_defaults_to_region(scenes):
    """`placement` separates "is an instance" from "gets region-placed", so
    overlay modules (alert) can have an id without projectLayout hiding them."""
    scenes.save(_doc([{"id": "clock", "type": "clock", "values": {}}]))
    assert scenes.load()["instances"][0]["placement"] == "region"


def test_overlay_placement_round_trips(scenes):
    scenes.save(_doc([
        {"id": "alert", "type": "alert", "profile": "default",
         "values": {}, "placement": "overlay"},
    ]))
    assert scenes.load()["instances"][0]["placement"] == "overlay"


def test_layout_can_reference_an_instance_owned_by_another_save(scenes):
    """A save that carries layout rows but not the instances they point at
    must not drop them as dangling — the instances live in the table already."""
    scenes.save(_doc([
        {"id": "clock-domes", "type": "clock", "profile": "domes",
         "values": {}},
    ]))
    scenes.save({
        "instances": [],
        "defaults": {"domes": [{"id": "clock-domes", "position": "top_left"}]},
        "windows": {},
    })
    assert scenes.load()["defaults"]["domes"] == [
        {"id": "clock-domes", "position": "top_left"}]


def test_uninstalling_a_type_removes_it_from_every_profile(scenes):
    """Uninstall deletes the cloned repo, so the module stops working for
    everyone — leaving one profile's instance behind would point at code that
    is gone."""
    scenes.save(_doc(
        [{"id": "mail-domes", "type": "MMM-Mail", "profile": "domes",
          "values": {}},
         {"id": "mail-tomas", "type": "MMM-Mail", "profile": "tomas",
          "values": {}},
         {"id": "clock-domes", "type": "clock", "profile": "domes",
          "values": {}}],
        defaults={"domes": [{"id": "mail-domes", "position": "top_left"}],
                  "tomas": [{"id": "mail-tomas", "position": "top_right"}]},
    ))

    removed = scenes.remove_instances_of_type("MMM-Mail")

    assert removed == {"mail-domes", "mail-tomas"}
    back = scenes.load()
    assert {i["id"] for i in back["instances"]} == {"clock-domes"}
    # The FK cascade must take their placements with them.
    assert back["defaults"].get("domes", []) == []
    assert back["defaults"].get("tomas", []) == []
