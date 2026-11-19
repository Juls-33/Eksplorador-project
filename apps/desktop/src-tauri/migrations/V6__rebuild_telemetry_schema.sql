-- V6: create telemetry replacement table. The Rust V6 hook performs a
-- schema-aware row copy and table swap in the same migration transaction.
-- V3 legacy seed script remains intentionally disabled.
-- Create target telemetry table with full columns and explicit FK to missions
CREATE TABLE IF NOT EXISTS telemetry_rebuilt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    latitude REAL,
    longitude REAL,
    ph REAL,
    moisture REAL,
    ec REAL,
    nitrogen REAL,
    phosphorus REAL,
    potassium REAL,
    mission_id INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT NULL,
    updated_at TEXT DEFAULT NULL,
    plot TEXT,
    overall REAL,
    location_source TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(id)
);
