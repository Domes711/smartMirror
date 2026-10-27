"""Schema guarantees the design relies on.

These pin the constraints, not the code: every one of them is a rule the
feature code is allowed to stop checking because the database refuses the
write itself.
"""

import pytest
import sqlite3

from shared import db
from data import (ai_module_messages, ai_module_sessions, camera_photos,
                  device_config, module_catalog, module_fields, profiles,
                  scene_default_entries, scene_instances,
                  scene_window_entries, scene_windows)


# --------------------------------------------------------------------------- #
# profiles
# --------------------------------------------------------------------------- #
def test_migration_seeds_exactly_one_default(sandbox):
    assert profiles.names() == ["default"]
    assert profiles.default_name() == "default"
    assert profiles.is_default("default") is True


def test_only_one_profile_may_be_default(sandbox):
    """idx_one_default: a partial unique index, because a plain UNIQUE would
    also forbid two non-default profiles."""
    profiles.ensure("dominik")
    with pytest.raises(sqlite3.IntegrityError):
        db.connect().execute(
            "UPDATE profiles SET is_default = 1 WHERE name = 'dominik'")


def test_many_profiles_may_be_non_default(sandbox):
    for name in ("a", "b", "c"):
        profiles.ensure(name)
    assert profiles.names() == ["default", "a", "b", "c"]


def test_ensure_is_idempotent(sandbox):
    profiles.ensure("dominik")
    profiles.ensure("dominik")
    assert profiles.names().count("dominik") == 1


def test_deleting_profile_cascades_everything(sandbox):
    mid = module_catalog.upsert("clock", "custom")
    profiles.ensure("dominik")
    scene_instances.insert("clock-dom", mid, "dominik", {})
    wid = scene_windows.insert("dominik", "day", "0 0 * * *", "59 23 * * *")
    scene_window_entries.insert(wid, "clock-dom", "top_left")
    scene_default_entries.insert("dominik", "clock-dom", "top_right")
    camera_photos.add("dominik", "1.jpg")
    device_config.set_value("monitor", "brightness_day", 10, profile="dominik")

    profiles.delete("dominik")

    assert scene_instances.list_all() == []
    assert scene_windows.list_all() == []
    assert scene_window_entries.for_window(wid) == []
    assert scene_default_entries.for_profile("dominik") == []
    assert camera_photos.files_for("dominik") == []
    assert device_config.overrides("monitor", "dominik") == {}
    # The defaults are untouched by one person leaving.
    assert device_config.defaults("monitor")["brightness_day"] == 80


# --------------------------------------------------------------------------- #
# module_catalog
# --------------------------------------------------------------------------- #
def test_module_name_is_unique(sandbox):
    module_catalog.upsert("clock", "custom")
    with pytest.raises(sqlite3.IntegrityError):
        db.connect().execute(
            "INSERT INTO module_catalog(module_name, source) "
            "VALUES ('clock', 'custom')")


def test_upsert_updates_in_place_and_keeps_id(sandbox):
    first = module_catalog.upsert("clock", "custom", label_cs="Hodiny")
    again = module_catalog.upsert("clock", "installed", label_cs="Clock")
    assert first == again
    row = module_catalog.get(first)
    assert row["source"] == "installed"
    assert row["label_cs"] == "Clock"


def test_upsert_never_forgets_installed_at(sandbox):
    """Re-seeding the community catalog must not drop the fact that a module
    is installed on this Pi."""
    mid = module_catalog.mark_installed("MMM-Foo", "https://github.com/x/y")
    assert module_catalog.get(mid)["installed_at"]
    module_catalog.upsert("MMM-Foo", "community", label_cs="Foo")
    assert module_catalog.get(mid)["installed_at"]


def test_unknown_source_is_refused(sandbox):
    with pytest.raises(ValueError):
        module_catalog.upsert("clock", "builtin")   # merged into `custom`


def test_list_on_disk_excludes_community(sandbox):
    module_catalog.upsert("clock", "custom")
    module_catalog.upsert("MMM-Inst", "installed")
    module_catalog.upsert("MMM-Comm", "community")
    module_catalog.upsert("MMM-AI", "ai")
    assert [m["module_name"] for m in module_catalog.list_on_disk()] == [
        "MMM-AI", "MMM-Inst", "clock"]


# --------------------------------------------------------------------------- #
# ai_module_sessions / ai_module_messages
# --------------------------------------------------------------------------- #
def test_ai_session_name_is_unique(sandbox):
    """One Claude conversation per module for its whole lifetime — draft and
    installed share the same row, so a second row for the same name (any
    scope) must be refused."""
    ai_module_sessions.create("draft", "MMM-Foo")
    with pytest.raises(sqlite3.IntegrityError):
        db.connect().execute(
            "INSERT INTO ai_module_sessions(scope, name) "
            "VALUES ('installed', 'MMM-Foo')")


def test_ai_session_unknown_scope_is_refused(sandbox):
    with pytest.raises(ValueError):
        ai_module_sessions.create("published", "MMM-Foo")


def test_set_scope_flips_draft_to_installed(sandbox):
    sid = ai_module_sessions.create("draft", "MMM-Foo")
    ai_module_sessions.set_scope(sid, "installed")
    assert ai_module_sessions.get(sid)["scope"] == "installed"


def test_claude_session_id_survives_a_scope_flip(sandbox):
    """Editing an already-installed module flips its row back to 'draft' and
    forward again on install — the agent must keep remembering everything,
    so claude_session_id must not be touched by set_scope."""
    sid = ai_module_sessions.create("installed", "MMM-Foo")
    ai_module_sessions.set_claude_session_id(sid, "claude-abc123")
    ai_module_sessions.set_scope(sid, "draft")
    assert ai_module_sessions.get(sid)["claude_session_id"] == "claude-abc123"
    ai_module_sessions.set_scope(sid, "installed")
    assert ai_module_sessions.get(sid)["claude_session_id"] == "claude-abc123"


def test_get_by_name_finds_the_single_row(sandbox):
    ai_module_sessions.create("draft", "MMM-Foo")
    assert ai_module_sessions.get_by_name("MMM-Foo")["scope"] == "draft"
    assert ai_module_sessions.get_by_name("MMM-Bar") is None


def test_list_by_scope_filters_and_sorts(sandbox):
    ai_module_sessions.create("draft", "MMM-Zeta")
    ai_module_sessions.create("draft", "MMM-Alpha")
    ai_module_sessions.create("installed", "MMM-Other")
    names = [r["name"] for r in ai_module_sessions.list_by_scope("draft")]
    assert names == ["MMM-Alpha", "MMM-Zeta"]


def test_deleting_a_session_cascades_its_messages(sandbox):
    sid = ai_module_sessions.create("draft", "MMM-Foo")
    ai_module_messages.add(sid, "user", "make it blue")
    ai_module_messages.add(sid, "assistant", "done")
    ai_module_sessions.delete(sid)
    assert ai_module_messages.list_for(sid) == []


def test_deleting_a_session_nulls_the_catalog_link_not_the_module(sandbox):
    """The module itself (module_catalog row) must survive its AI session
    being deleted — only the link is cleared."""
    sid = ai_module_sessions.create("installed", "MMM-Foo")
    mid = module_catalog.upsert("MMM-Foo", "ai", ai_module_session_id=sid)
    ai_module_sessions.delete(sid)
    row = module_catalog.get(mid)
    assert row is not None
    assert row["ai_module_session_id"] is None


def test_messages_are_returned_in_order(sandbox):
    sid = ai_module_sessions.create("draft", "MMM-Foo")
    ai_module_messages.add(sid, "user", "first")
    ai_module_messages.add(sid, "assistant", "second")
    msgs = ai_module_messages.list_for(sid)
    assert [m["text"] for m in msgs] == ["first", "second"]


def test_message_unknown_role_is_refused(sandbox):
    sid = ai_module_sessions.create("draft", "MMM-Foo")
    with pytest.raises(ValueError):
        ai_module_messages.add(sid, "system", "nope")


def test_catalog_upsert_never_forgets_the_ai_session_link(sandbox):
    """Re-seeding/updating a catalog row must not drop the AI session link,
    same guarantee as installed_at."""
    sid = ai_module_sessions.create("installed", "MMM-Foo")
    mid = module_catalog.upsert("MMM-Foo", "ai", ai_module_session_id=sid)
    module_catalog.upsert("MMM-Foo", "ai", label_cs="Foo")
    assert module_catalog.get(mid)["ai_module_session_id"] == sid


def test_set_ai_session_links_an_existing_community_module(sandbox):
    """Opening a community module in the AI builder for the first time
    claims it for AI editing without touching its other fields."""
    mid = module_catalog.upsert("MMM-Comm", "community", label_cs="Comm")
    sid = ai_module_sessions.create("draft", "MMM-Comm")
    module_catalog.set_ai_session("MMM-Comm", sid)
    row = module_catalog.get(mid)
    assert row["ai_module_session_id"] == sid
    assert row["source"] == "community"   # untouched


# --------------------------------------------------------------------------- #
# scene_instances
# --------------------------------------------------------------------------- #
def test_instance_requires_a_real_module(sandbox):
    """The FK the old `type TEXT` column could not provide: a typo used to
    create a silently broken instance."""
    with pytest.raises(sqlite3.IntegrityError):
        scene_instances.insert("x", 9999, "default", {})


def test_one_instance_per_module_and_profile(sandbox):
    mid = module_catalog.upsert("MMM-Mail", "custom")
    scene_instances.insert("mail-def", mid, "default", {})
    with pytest.raises(sqlite3.IntegrityError):
        scene_instances.insert("mail-again", mid, "default", {})


def test_same_module_gets_its_own_instance_per_profile(sandbox):
    """A personalised module (mail) needs separate credentials per person."""
    mid = module_catalog.upsert("MMM-Mail", "custom")
    profiles.ensure("dominik")
    scene_instances.insert("mail-def", mid, "default", {"user": "a@b.cz"})
    scene_instances.insert("mail-dom", mid, "dominik", {"user": "d@b.cz"})
    got = {i["profile"]: i["values"]["user"]
           for i in scene_instances.list_all()}
    assert got == {"default": "a@b.cz", "dominik": "d@b.cz"}


def test_uninstalling_a_module_removes_every_profiles_instance(sandbox):
    mid = module_catalog.upsert("MMM-Mail", "custom")
    profiles.ensure("dominik")
    scene_instances.insert("mail-def", mid, "default", {})
    scene_instances.insert("mail-dom", mid, "dominik", {})
    wid = scene_windows.insert("default", "day", "0 0 * * *", "59 23 * * *")
    scene_window_entries.insert(wid, "mail-def", "top_left")

    module_catalog.delete(mid)

    assert scene_instances.list_all() == []
    assert scene_window_entries.for_window(wid) == []


def test_deleting_instance_cascades_its_layout_rows(sandbox):
    mid = module_catalog.upsert("clock", "custom")
    scene_instances.insert("clock-def", mid, "default", {})
    wid = scene_windows.insert("default", "day", "0 0 * * *", "59 23 * * *")
    scene_window_entries.insert(wid, "clock-def", "top_left")
    scene_default_entries.insert("default", "clock-def", "top_right")

    scene_instances.delete_for_profile("default")

    assert scene_window_entries.for_window(wid) == []
    assert scene_default_entries.for_profile("default") == []


def test_values_round_trip_as_json(sandbox):
    mid = module_catalog.upsert("weather", "custom")
    vals = {"lat": 49.195, "lon": 16.608, "apiKey": "k", "ok": True,
            "list": [1, 2]}
    scene_instances.insert("w", mid, "default", vals)
    assert scene_instances.get("w")["values"] == vals


def test_placement_defaults_to_region(sandbox):
    mid = module_catalog.upsert("clock", "custom")
    scene_instances.insert("c", mid, "default", {})
    assert scene_instances.get("c")["placement"] == "region"


def test_list_with_module_name_joins_the_catalog(sandbox):
    mid = module_catalog.upsert("MMM-Brno-Transit", "custom")
    scene_instances.insert("t", mid, "default", {})
    got = scene_instances.list_with_module_name()
    assert got[0]["module"] == "MMM-Brno-Transit"
    assert got[0]["module_id"] == mid


# --------------------------------------------------------------------------- #
# module_fields
# --------------------------------------------------------------------------- #
def test_field_keys_are_unique_per_module(sandbox):
    """Two fields with one key would overwrite each other in values_json."""
    mid = module_catalog.upsert("clock", "custom")
    module_fields.replace(mid, [{"key": "a", "label": "A"}])
    with pytest.raises(sqlite3.IntegrityError):
        db.connect().execute(
            "INSERT INTO module_fields(module_id, key) VALUES (?, 'a')", (mid,))


def test_fields_replace_wipes_the_previous_set(sandbox):
    mid = module_catalog.upsert("clock", "custom")
    module_fields.replace(mid, [{"key": "old"}])
    module_fields.replace(mid, [{"key": "new", "required": True}])
    got = module_fields.for_module(mid)
    assert [f["key"] for f in got] == ["new"]
    assert got[0]["required"] is True


def test_fields_cascade_with_their_module(sandbox):
    mid = module_catalog.upsert("clock", "custom")
    module_fields.replace(mid, [{"key": "a"}])
    module_catalog.delete(mid)
    assert module_fields.for_module(mid) == []


# --------------------------------------------------------------------------- #
# hardware config
# --------------------------------------------------------------------------- #
def test_migration_seeds_the_hardcoded_values(sandbox):
    """These were constants in the daemons; the DB now owns them."""
    cam = device_config.defaults("camera")
    assert cam["rotation"] == 180          # camera is mounted upside down
    assert cam["recognition_timeout_s"] == 3.0
    assert cam["recognition_tolerance"] == 0.5
    mon = device_config.defaults("monitor")
    assert mon["dim_timeout_s"] == 30
    assert mon["brightness_day"] == 80


def test_every_device_has_a_table(sandbox):
    for device in device_config.DEVICES:
        assert isinstance(device_config.resolve(device), dict)


def test_unknown_device_is_refused_not_interpolated(sandbox):
    """`device` reaches SQL as a table name, so it must be whitelisted."""
    with pytest.raises(ValueError):
        device_config.resolve("monitor; DROP TABLE profiles")


def test_profile_with_no_rows_gets_the_defaults(sandbox):
    profiles.ensure("dominik")
    assert device_config.resolve("monitor", "dominik") == \
        device_config.defaults("monitor")


def test_override_replaces_only_its_own_key(sandbox):
    profiles.ensure("dominik")
    device_config.set_value("monitor", "brightness_night", 5,
                            profile="dominik")
    got = device_config.resolve("monitor", "dominik")
    assert got["brightness_night"] == 5          # overridden
    assert got["brightness_day"] == 80           # still the default
    assert got["dim_timeout_s"] == 30
    # The default row itself is untouched.
    assert device_config.defaults("monitor")["brightness_night"] == 20


def test_override_is_upserted_not_duplicated(sandbox):
    profiles.ensure("dominik")
    device_config.set_value("monitor", "brightness_day", 10, profile="dominik")
    device_config.set_value("monitor", "brightness_day", 20, profile="dominik")
    assert device_config.resolve("monitor", "dominik")["brightness_day"] == 20


def test_config_for_unknown_profile_is_refused(sandbox):
    with pytest.raises(sqlite3.IntegrityError):
        db.connect().execute(
            "INSERT INTO monitor_config(profile, key, value) "
            "VALUES ('nobody', 'x', '1')")


def test_clearing_an_override_falls_back_to_the_default(sandbox):
    profiles.ensure("dominik")
    device_config.set_value("monitor", "brightness_day", 10, profile="dominik")
    device_config.clear_override("monitor", "brightness_day", "dominik")
    assert device_config.resolve("monitor", "dominik")["brightness_day"] == 80


def test_defaults_cannot_be_cleared(sandbox):
    """Deleting a default row would leave the device with no value at all."""
    with pytest.raises(ValueError):
        device_config.clear_override("monitor", "brightness_day", "default")
    with pytest.raises(ValueError):
        device_config.clear_overrides("monitor", "default")


def test_values_keep_their_json_type(sandbox):
    device_config.set_many("radar", {"zone": {"x": 400, "y": 1500},
                                     "invert_x": False, "alpha": 0.3,
                                     "exclusions": [[1, 2]]})
    got = device_config.resolve("radar")
    assert got["zone"] == {"x": 400, "y": 1500}
    assert got["invert_x"] is False
    assert got["alpha"] == 0.3
    assert got["exclusions"] == [[1, 2]]


def test_camera_has_no_overrides_by_design(sandbox):
    """The camera determines the profile, so it cannot be configured per
    profile. Nothing enforces it in the schema — this pins the intent."""
    assert device_config.profiles_with_overrides("camera") == []
