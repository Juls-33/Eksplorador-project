PRAGMA foreign_keys = ON;

-- 1. CROPS
CREATE TABLE IF NOT EXISTS crops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    target_ph_min REAL,
    target_ph_max REAL,
    target_moisture_min REAL,
    target_moisture_max REAL,
    ec_tolerance_max REAL,
    optimal_nitrogen REAL,
    optimal_phosphorus REAL,
    optimal_potassium REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. FIELDS (Spatial Boundaries)
CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    boundary_geojson TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. MISSIONS (Sampling Runs)
CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    pins_geojson TEXT,
    status TEXT CHECK(status IN ('planned', 'in_progress', 'completed', 'cancelled')) DEFAULT 'planned',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);