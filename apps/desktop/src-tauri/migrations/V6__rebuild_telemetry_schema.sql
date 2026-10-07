PRAGMA foreign_keys = OFF;

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
    FOREIGN KEY (mission_id) REFERENCES missions(id)
);

-- Copy existing data safely into the new table
INSERT OR IGNORE INTO telemetry_rebuilt (
    id, timestamp, latitude, longitude, ph, moisture, ec, 
    nitrogen, phosphorus, potassium, mission_id, created_at, updated_at,
    plot, overall
)
SELECT 
    id, timestamp, latitude, longitude, ph, moisture, ec, 
    nitrogen, phosphorus, potassium, mission_id, created_at, updated_at,
    plot, overall
FROM telemetry;

DROP TABLE telemetry;
ALTER TABLE telemetry_rebuilt RENAME TO telemetry;

PRAGMA foreign_keys = ON;