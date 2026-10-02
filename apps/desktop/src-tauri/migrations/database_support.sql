-- Additional application tables shared by Rust and the frontend.
-- Applied transactionally after the existing migrations.

CREATE TABLE IF NOT EXISTS _app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO _app_meta
VALUES ('source_id', lower(hex(randomblob(16))));

INSERT OR IGNORE INTO _app_meta
VALUES ('revision', '0');

INSERT OR IGNORE INTO _app_meta
VALUES ('transferring', '0');

CREATE TABLE IF NOT EXISTS crop_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    min_ph REAL,
    max_ph REAL,
    min_moisture REAL,
    max_moisture REAL,
    min_ec REAL,
    max_ec REAL,
    min_n REAL,
    max_n REAL,
    min_p REAL,
    max_p REAL,
    min_k REAL,
    max_k REAL,
    notes TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS field_amendments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    treatment TEXT NOT NULL,
    operator TEXT DEFAULT 'Operator',
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(field_id) REFERENCES fields(id) ON DELETE CASCADE
);