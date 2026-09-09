CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    latitude REAL,
    longitude REAL,
    ph REAL,
    moisture REAL,
    ec REAL
);