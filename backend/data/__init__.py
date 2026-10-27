"""Data access layer: one module per table, nothing else.

Rules (see docs/db-schema-cs.md):

  * SQL lives only here. No `SELECT` or `INSERT` outside this package.
  * Functions return `dict` / `list[dict]`, never `sqlite3.Row` — callers
    must not learn that SQLite is underneath.
  * No business logic. Validation, config derivation (codegen.module_config)
    and MQTT stay in the feature; this package only reads and writes.
  * Transactions belong to the caller: these are single operations, and a
    caller needing atomicity wraps them in `with db.tx():`.
  * `shared/db.py` stays as it is — connection, WAL, migrations, tx, jload /
    jdump. This package uses it, it does not replace it.
"""
