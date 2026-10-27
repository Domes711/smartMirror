"""Central SQLite database — connection, WAL mode, schema migrations.

One DB file (`backend/var/smartmirror.db`) holds all persistent state: scenes
and module instances, the module catalog, radar calibration and profiles.

Several OS processes read it concurrently (the scenes/modules API, the radar
daemon, the camera supervisor), so WAL mode is mandatory — it lets readers
proceed while one writer holds the write lock, instead of serialising everyone
behind `BEGIN EXCLUSIVE`.

Each feature owns the tables prefixed with its name; `profiles` is the one
cross-cutting table (both `camera` and `scenes` reference it) and lives here.
"""

import json
import logging
import os
import sqlite3
import threading

from . import paths

log = logging.getLogger("db")

_local = threading.local()

# Bump when adding a migration below. Migrations are append-only: never edit a
# released one, add the next.
MIGRATIONS = []


def migration(fn):
    MIGRATIONS.append(fn)
    return fn


# --------------------------------------------------------------------------- #
# connection
# --------------------------------------------------------------------------- #
def connect() -> sqlite3.Connection:
    """Thread-local connection. sqlite3 objects are not thread-safe to share,
    and every entrypoint here is threaded (HTTP handlers, MQTT callbacks)."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    os.makedirs(os.path.dirname(paths.DB_PATH), exist_ok=True)
    conn = sqlite3.connect(paths.DB_PATH, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=15000")
    _local.conn = conn
    return conn


class tx:
    """`with db.tx() as c:` — one immediate transaction, rolled back on error.

    IMMEDIATE (not DEFERRED) because a read-then-write under WAL can otherwise
    fail with SQLITE_BUSY_SNAPSHOT when upgrading the lock mid-transaction.
    """

    def __enter__(self):
        self.conn = connect()
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.conn.execute("COMMIT")
        else:
            self.conn.execute("ROLLBACK")
        return False


def query(sql: str, params=()) -> list:
    return connect().execute(sql, params).fetchall()


def one(sql: str, params=()):
    return connect().execute(sql, params).fetchone()


def jload(value, default=None):
    """Parse a JSON text column, tolerating NULL / corruption."""
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:  # noqa: BLE001
        return default


def jdump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# schema
# --------------------------------------------------------------------------- #
# Hardware devices that get a `<device>_config` key-value table. Same shape for
# all of them, so `data.device_config` serves them with one implementation.
DEVICES = ("radar", "camera", "monitor", "distance", "mic", "speaker")

# Seeded `profile='default'` rows per device: the values that used to be
# hardcoded in the daemons. Empty dict = table exists, parameters come later.
DEVICE_DEFAULTS = {
    "camera": {
        # The camera is mounted upside down, hence 180 (was cv2.ROTATE_180 in
        # the supervisor capture loop).
        "rotation": 180,
        "resolution_width": 640,
        "resolution_height": 480,
        "framerate": 15,
        "recognition_timeout_s": 3.0,
        "recognition_tolerance": 0.5,
        "brightness": 0.0,          # -1.0..1.0
        "contrast": 1.0,            # 1.0 = normal
        "saturation": 1.0,          # 1.0 = normal, 0.0 = greyscale
        "sharpness": 1.0,           # 0.0 = no sharpening
        "auto_exposure": True,
        "exposure_time_us": None,   # manual only, microseconds
        "exposure_value": 0.0,      # EV compensation, works alongside AE
        "auto_white_balance": True,
        "awb_mode": "Auto",         # Auto/Incandescent/Tungsten/Fluorescent/
                                    # Indoor/Daylight/Cloudy/Custom
        "analogue_gain": None,      # manual only, >=1.0
        "noise_reduction": "Fast",  # Off/Fast/HighQuality/Minimal
    },
    "monitor": {
        "brightness_day": 80,
        "brightness_night": 20,
        "dim_timeout_s": 30,
        "sleep_timeout_s": 120,
        "ddc_bus": "",
    },
    # radar defaults live in features/radar/config.py DEFAULTS and are written
    # on first load; mic defaults live in features/mic/config.py DEFAULTS,
    # same pattern. distance/speaker have no parameters yet.
    "radar": {},
    "distance": {},
    "mic": {},
    "speaker": {},
}


@migration
def _m001_initial(conn):
    conn.executescript("""
    -- cross-cutting: a profile is a person the mirror knows. Both the camera
    -- (trained faces) and scenes (per-profile layouts) reference it, so it is
    -- a real row with FK integrity rather than "a dataset/ dir that exists".
    CREATE TABLE profiles (
        name        TEXT PRIMARY KEY,
        -- 1 = the profile shown when nobody is recognized (wake-up before
        -- face-reco finishes, user_unknown). Exactly one row has it; the
        -- partial unique index below enforces that. Deleting it is refused in
        -- code, because the mirror would have nothing to fall back to.
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Only one row may carry is_default=1; any number may carry 0. A partial
    -- index is the only way to say that in SQLite (a plain UNIQUE would also
    -- forbid two zeroes).
    CREATE UNIQUE INDEX idx_one_default ON profiles(is_default)
        WHERE is_default = 1;

    -- ai_modules -------------------------------------------------------------
    -- One row per module name, ever opened in the AI module builder — one
    -- Claude conversation for its whole lifetime, draft and installed alike.
    -- `scope` is the state of the *working copy* right now, not a key: it is
    -- overwritten in place as the module moves between the two. 'draft'
    -- means an in-progress copy sits in features/ai_modules/modules/<name>/
    -- awaiting install; 'installed' means no pending copy exists, the last
    -- result is live in MagicMirror/modules/<name>/. Editing an
    -- already-installed module (AI-built or community) flips this row back
    -- to 'draft' while a new working copy is edited, without touching the
    -- live module until install — and keeps the same claude_session_id, so
    -- the agent remembers everything from before.
    CREATE TABLE ai_module_sessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        scope       TEXT NOT NULL,
        name        TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        -- The Claude CLI's own conversation id, so `claude --resume <id>`
        -- continues the same agent conversation across restarts. Separate
        -- from the chat transcript in ai_module_messages: this is the CLI's
        -- bookkeeping, not content a user reads.
        claude_session_id TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ai_module_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  INTEGER NOT NULL REFERENCES ai_module_sessions(id) ON DELETE CASCADE,
        role        TEXT NOT NULL,   -- 'user' | 'assistant' | 'sys'
        text        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_ai_module_messages ON ai_module_messages(session_id);

    -- modules --------------------------------------------------------------
    -- What is *available*. `id` is the identity everything else FKs to;
    -- `module_name` is what is on disk under MagicMirror/modules/ and what
    -- gets handed to the core.
    CREATE TABLE module_catalog (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        module_name     TEXT NOT NULL UNIQUE,
        label_cs        TEXT NOT NULL DEFAULT '',
        label_en        TEXT NOT NULL DEFAULT '',
        description_cs  TEXT NOT NULL DEFAULT '',
        description_en  TEXT NOT NULL DEFAULT '',
        category        TEXT NOT NULL DEFAULT '',
        -- custom    = in this repo (ours or AI-built) — already on disk, so
        --             installing clones nothing
        -- installed = cloned from upstream onto this Pi
        -- community = browse-only until installed; the only source that clones
        -- ai        = built or last edited via the AI module builder
        source          TEXT NOT NULL,
        repo_url        TEXT NOT NULL DEFAULT '',
        maintainer      TEXT NOT NULL DEFAULT '',
        stars           INTEGER,
        installed_at    TEXT,
        -- Set once a module has ever been built/edited via the AI module
        -- builder — the link to its conversation history. NULL for a module
        -- nobody has ever opened in the AI builder, and set back to NULL if
        -- that session is ever deleted (the module itself is untouched).
        ai_module_session_id INTEGER REFERENCES ai_module_sessions(id)
                              ON DELETE SET NULL
    );

    CREATE TABLE module_fields (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id   INTEGER NOT NULL REFERENCES module_catalog(id) ON DELETE CASCADE,
        key         TEXT NOT NULL,
        label_cs    TEXT NOT NULL DEFAULT '',
        label_en    TEXT NOT NULL DEFAULT '',
        required    INTEGER NOT NULL DEFAULT 0,
        field_type  TEXT NOT NULL DEFAULT 'text',
        placeholder TEXT NOT NULL DEFAULT '',
        help        TEXT NOT NULL DEFAULT '',
        options_json TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        -- two fields with the same key would overwrite each other in
        -- scene_instances.values_json
        UNIQUE (module_id, key)
    );

    -- Remote preview URLs from the upstream catalog (several per module).
    CREATE TABLE module_images (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id   INTEGER NOT NULL REFERENCES module_catalog(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        caption     TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0
    );

    -- Local screenshot files under var/module-assets/. Distinct from
    -- module_images: these are served off disk, those are fetched remotely.
    CREATE TABLE module_screenshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id   INTEGER NOT NULL REFERENCES module_catalog(id) ON DELETE CASCADE,
        asset_path  TEXT NOT NULL,
        caption     TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE module_tags (
        module_id   INTEGER NOT NULL REFERENCES module_catalog(id) ON DELETE CASCADE,
        tag         TEXT NOT NULL,
        PRIMARY KEY (module_id, tag)
    );

    -- Install progress. Deliberately keyed by name and without an FK: the job
    -- must outlive the catalog row so a failed install can still be shown.
    CREATE TABLE module_install_jobs (
        id          TEXT PRIMARY KEY,
        module_name TEXT NOT NULL,
        status      TEXT NOT NULL,
        phase       TEXT NOT NULL DEFAULT '',
        percent     INTEGER NOT NULL DEFAULT 0,
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        error       TEXT
    );

    CREATE INDEX idx_module_fields ON module_fields(module_id);
    CREATE INDEX idx_module_images ON module_images(module_id);
    CREATE INDEX idx_module_shots ON module_screenshots(module_id);

    -- scenes ---------------------------------------------------------------
    -- An *instance* is a configured module owned by one profile. The split:
    --   module_catalog   what is available (one row per module)
    --   scene_instances  what is configured (one row per module+profile)
    --   scene_*_entries  where and when it shows
    -- Installing a module clones it and configures nothing; adding it to a
    -- scene is what creates the instance, under the profile that added it. A
    -- second profile adding the same module does not re-clone — it gets its
    -- own instance with its own values (a personalised module like mail needs
    -- separate credentials per person).
    CREATE TABLE scene_instances (
        id          TEXT PRIMARY KEY,
        module_id   INTEGER NOT NULL REFERENCES module_catalog(id) ON DELETE CASCADE,
        profile     TEXT NOT NULL REFERENCES profiles(name) ON DELETE CASCADE,
        -- raw field values the editor re-populates its form from. The config
        -- MagicMirror receives is derived from these by codegen.module_config
        -- on every generate, never cached — a fixed mapping must apply to
        -- instances saved before the fix.
        values_json TEXT NOT NULL DEFAULT '{}',
        -- `region`  placed by the profile system from pages.js
        -- `overlay` renders through its own mechanism (alert) — has an id
        --           like any instance, but projectLayout must not move or
        --           hide it
        placement   TEXT NOT NULL DEFAULT 'region',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        -- One instance of a module per profile. Two mailboxes for one person
        -- is deliberately out of scope for now.
        UNIQUE (module_id, profile)
    );

    CREATE INDEX idx_instances_profile ON scene_instances(profile);
    CREATE INDEX idx_instances_module ON scene_instances(module_id);

    CREATE TABLE scene_windows (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        profile     TEXT NOT NULL REFERENCES profiles(name) ON DELETE CASCADE,
        window_name TEXT NOT NULL,
        from_cron   TEXT NOT NULL,
        to_cron     TEXT NOT NULL,
        label       TEXT NOT NULL DEFAULT '',
        UNIQUE (profile, window_name)
    );

    CREATE TABLE scene_window_entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        window_id   INTEGER NOT NULL REFERENCES scene_windows(id) ON DELETE CASCADE,
        instance_id TEXT NOT NULL REFERENCES scene_instances(id) ON DELETE CASCADE,
        position    TEXT NOT NULL,
        sort        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE scene_default_entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        profile     TEXT NOT NULL REFERENCES profiles(name) ON DELETE CASCADE,
        instance_id TEXT NOT NULL REFERENCES scene_instances(id) ON DELETE CASCADE,
        position    TEXT NOT NULL,
        sort        INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_window_entries ON scene_window_entries(window_id);
    CREATE INDEX idx_default_entries ON scene_default_entries(profile);

    -- camera ---------------------------------------------------------------
    CREATE TABLE camera_photos (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_name TEXT NOT NULL REFERENCES profiles(name) ON DELETE CASCADE,
        file_path    TEXT NOT NULL,
        captured_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (profile_name, file_path)
    );

    CREATE INDEX idx_camera_photos ON camera_photos(profile_name);
    """)

    # The fallback profile always exists and cannot be deleted. It must be
    # inserted before any <device>_config row, which FKs into it.
    conn.execute("INSERT INTO profiles(name, is_default) VALUES ('default', 1)")

    # Hardware config: one key-value table per device. `profile='default'`
    # rows are the defaults; a row naming a profile overrides that one key for
    # that person (see docs/db-schema-cs.md).
    for device in DEVICES:
        conn.executescript(f"""
        CREATE TABLE {device}_config (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            profile TEXT NOT NULL DEFAULT 'default'
                    REFERENCES profiles(name) ON DELETE CASCADE,
            key     TEXT NOT NULL,
            value   TEXT NOT NULL,          -- JSON-encoded, numbers included
            UNIQUE (profile, key)
        );
        CREATE INDEX idx_{device}_config ON {device}_config(profile);
        """)
        for key, value in DEVICE_DEFAULTS[device].items():
            conn.execute(
                f"INSERT INTO {device}_config(profile, key, value) "
                "VALUES ('default', ?, ?)", (key, jdump(value)))


def init() -> None:
    """Apply any pending migrations. Idempotent; safe to call from every
    entrypoint at startup (first one in wins, the rest no-op)."""
    conn = connect()
    conn.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')))""")
    applied = {r[0] for r in conn.execute(
        "SELECT version FROM schema_migrations")}
    for i, fn in enumerate(MIGRATIONS, start=1):
        if i in applied:
            continue
        log.info("applying migration %03d (%s)", i, fn.__name__)
        # No explicit transaction here: a migration may use executescript(),
        # which commits any open transaction before running and would leave
        # the COMMIT below with nothing to commit. Each migration is therefore
        # responsible for being safe to re-run, and the version row is written
        # only after it completes.
        fn(conn)
        conn.execute("INSERT INTO schema_migrations(version) VALUES (?)", (i,))
