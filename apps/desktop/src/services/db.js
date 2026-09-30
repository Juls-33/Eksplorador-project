import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { boundaryToGeoJSON, geoJSONToBoundary, pinsToGeoJSON, geoJSONToPins } from '../utils/fieldGeo';

let dbPromise = null;

export async function initDatabase() {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:eksplorador.db').then(async (db) => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mission_id TEXT,
          plot TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          latitude REAL,
          longitude REAL,
          moisture REAL,
          ph REAL,
          ec REAL,
          nitrogen REAL,
          phosphorus REAL,
          potassium REAL,
          overall REAL
        )`
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS crop_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          min_ph REAL, max_ph REAL,
          min_moisture REAL, max_moisture REAL,
          min_ec REAL, max_ec REAL,
          min_n REAL, max_n REAL,
          min_p REAL, max_p REAL,
          min_k REAL, max_k REAL,
          notes TEXT DEFAULT ''
        )`
      );
      await seedDefaultCropProfiles(db);
      await ensureFieldTables(db);
      await ensureTelemetryColumns(db);
      await backfillLegacyTelemetry(db);
      return db;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Crop profiles (Crop Assessment tab)
// ---------------------------------------------------------------------------
const t = (minPh, maxPh, minMoisture, maxMoisture, minEC, maxEC, minN, maxN, minP, maxP, minK, maxK) => ({
  minPh, maxPh, minMoisture, maxMoisture, minEC, maxEC, minN, maxN, minP, maxP, minK, maxK
});

const DEFAULT_CROP_PROFILES = [
  { id: 'CRP-001', name: 'Rice (Oryza sativa)', category: 'Cereal / Grain', notes: '', thresholds: t(5.5, 7.0, 40, 80, 0.5, 2.0, 20, 40, 30, 50, 40, 70) },
  { id: 'CRP-002', name: 'Sweet Corn (Zea mays)', category: 'Cereal / Grain', notes: '', thresholds: t(5.8, 7.2, 30, 60, 0.8, 1.8, 30, 50, 25, 45, 35, 60) },
  { id: 'CRP-003', name: 'Cassava / Tuber', category: 'Root Crop', notes: '', thresholds: t(5.0, 6.5, 25, 50, 0.4, 1.2, 15, 30, 20, 35, 40, 60) },
  { id: 'CRP-004', name: 'Leafy Greens (Pechay / Brassica)', category: 'Vegetable', notes: '', thresholds: t(6.0, 7.5, 50, 75, 1.0, 2.5, 35, 60, 30, 50, 40, 65) }
];

async function upsertCropProfile(db, crop) {
  const th = crop.thresholds;
  await db.execute(
    `INSERT OR REPLACE INTO crop_profiles
      (id, name, category, min_ph, max_ph, min_moisture, max_moisture, min_ec, max_ec,
       min_n, max_n, min_p, max_p, min_k, max_k, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      crop.id, crop.name, crop.category,
      th.minPh, th.maxPh, th.minMoisture, th.maxMoisture, th.minEC, th.maxEC,
      th.minN, th.maxN, th.minP, th.maxP, th.minK, th.maxK,
      crop.notes || ''
    ]
  );
}

// Seeds the starter crops once, only while the table is empty.
async function seedDefaultCropProfiles(db) {
  const rows = await db.select('SELECT COUNT(*) AS total FROM crop_profiles');
  if (rows[0]?.total > 0) return;
  for (const crop of DEFAULT_CROP_PROFILES) {
    await upsertCropProfile(db, crop);
  }
}

function rowToCrop(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    notes: row.notes || '',
    thresholds: {
      minPh: row.min_ph, maxPh: row.max_ph,
      minMoisture: row.min_moisture, maxMoisture: row.max_moisture,
      minEC: row.min_ec, maxEC: row.max_ec,
      minN: row.min_n, maxN: row.max_n,
      minP: row.min_p, maxP: row.max_p,
      minK: row.min_k, maxK: row.max_k
    }
  };
}

// Called by CropAssessmentView.jsx
export async function fetchCropProfiles() {
  try {
    const db = await initDatabase();
    const rows = await db.select('SELECT * FROM crop_profiles ORDER BY id ASC');
    return rows.map(rowToCrop);
  } catch (error) {
    console.error('Failed to fetch crop profiles:', error);
    return [];
  }
}

// Insert or update one crop profile. Returns true on success, null on failure.
export async function saveCropProfile(crop) {
  try {
    const db = await initDatabase();
    await upsertCropProfile(db, crop);
    return true;
  } catch (error) {
    console.error('Failed to save crop profile:', error);
    return null;
  }
}

export async function deleteCropProfile(id) {
  try {
    const db = await initDatabase();
    await db.execute('DELETE FROM crop_profiles WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('Failed to delete crop profile:', error);
    return null;
  }
}

// Every plot that has recorded telemetry, with its sample count.
export async function fetchRecordedPlots() {
  try {
    const db = await initDatabase();
    const rows = await db.select(
      `SELECT plot, COUNT(*) AS sample_count
       FROM telemetry
       WHERE plot IS NOT NULL AND plot != ''
       GROUP BY plot
       ORDER BY plot ASC`
    );
    return rows.map(row => ({ plot: row.plot, sampleCount: row.sample_count }));
  } catch (error) {
    console.error('Failed to fetch recorded plots:', error);
    return [];
  }
}

// All georeferenced samples for one plot, in the short-key shape the views use.
export async function fetchPlotSamples(plot) {
  try {
    const db = await initDatabase();
    const rows = await db.select(
      `SELECT * FROM telemetry
       WHERE plot = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY timestamp ASC`,
      [plot]
    );
    return rows.map(row => ({
      ...row,
      lat: row.latitude,
      lng: row.longitude,
      coords: [row.latitude, row.longitude],
      n: row.nitrogen,
      p: row.phosphorus,
      k: row.potassium
    }));
  } catch (error) {
    console.error('Failed to fetch plot samples:', error);
    return [];
  }
}

// Called by FieldMapView.jsx during active logging
export async function saveSoilSample(sample) {
  try {
    const db = await initDatabase();
    await db.execute(
      `INSERT INTO telemetry 
      (mission_id, plot, timestamp, latitude, longitude, moisture, ph, ec, nitrogen, phosphorus, potassium, overall) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        sample.mission_id || 'UNASSIGNED',
        sample.plot || 'Main Field',
        sample.timestamp,
        sample.lat || sample.coords[0],
        sample.lng || sample.coords[1],
        sample.moisture,
        sample.ph,
        sample.ec,
        sample.n,
        sample.p,
        sample.k,
        sample.overall || 50
      ]
    );
    return true;
  } catch (error) {
    console.error('Failed to save soil sample to SQLite:', error);
    return null;
  }
}

// Called by FieldMapView.jsx to restore lines on mission switch
export async function fetchMissionSamples(missionId) {
  try {
    const db = await initDatabase();
    const rows = await db.select('SELECT * FROM telemetry WHERE mission_id = $1 ORDER BY timestamp ASC', [missionId]);
    // Map DB columns back to FieldMap's expected short keys
    return rows.map(row => ({
      ...row,
      lat: row.latitude,
      lng: row.longitude,
      coords: [row.latitude, row.longitude],
      n: row.nitrogen,
      p: row.phosphorus,
      k: row.potassium
    }));
  } catch (error) {
    console.error('Failed to fetch mission samples:', error);
    return [];
  }
}

// NEW: Called by ReportsView.jsx to pull all data for statistics
export async function getAllTelemetry() {
  try {
    const db = await initDatabase();
    return await db.select('SELECT * FROM telemetry ORDER BY timestamp DESC');
  } catch (error) {
    console.error('Failed to fetch all telemetry:', error);
    return [];
  }
}

export async function exportTelemetryPackage(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No recent samples to export.');
  }

  try {
    const suggestedName =
      'telemetry_export_' +
      new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') +
      '.json';

    const filePath = await save({
      title: 'Export telemetry',
      defaultPath: suggestedName,
      filters: [{ name: 'JSON files', extensions: ['json'] }]
    });

    if (!filePath) return { success: false, cancelled: true };

    const exportToPath = (overwrite) =>
      invoke('export_telemetry_to_project', { filePath, overwrite, records });

    try {
      const path = await exportToPath(false);
      return { success: true, path, cancelled: false };
    } catch (error) {
      if (!String(error).includes('EXPORT_FILE_EXISTS')) throw error;

      const actualPath = /\.json$/i.test(filePath)
        ? filePath
        : filePath + '.json';

      const replace = await confirm(
        'This file already exists:\n' + actualPath + '\n\nReplace it?',
        { title: 'Replace export file', kind: 'warning' }
      );

      if (!replace) return { success: false, cancelled: true };

      const path = await exportToPath(true);
      return { success: true, path, cancelled: false };
    }
  } catch (error) {
    console.error('Failed to export telemetry:', error);
    throw error;
  }
}

export async function importTelemetryPackage() {
  try {
    const selectedFile = await open({
      multiple: false,
      directory: false,
      defaultPath: 'data/exports',
      filters: [{ name: 'Telemetry JSON Package', extensions: ['json'] }]
    });

    if (!selectedFile) {
      return { success: false, count: 0, cancelled: true };
    }

    const filePath = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;
    const fileContent = await readTextFile(filePath);
    const parsed = JSON.parse(fileContent);

    if (!Array.isArray(parsed?.telemetry)) {
      throw new Error('The selected JSON file has no telemetry array.');
    }

    const insertedCount = await invoke('import_telemetry_json', { fileContent });

    if (insertedCount !== parsed.telemetry.length) {
      throw new Error(
        `Only ${insertedCount} of ${parsed.telemetry.length} records were imported. The recent table was not updated.`
      );
    }

    return {
      success: true,
      count: insertedCount,
      records: parsed.telemetry,
      cancelled: false
    };
  } catch (error) {
    console.error('Failed to import telemetry:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Fields & missions (Field Map view)
// ---------------------------------------------------------------------------
// fields / missions are the V5 tables; the CREATE statements below are identical
// to V5 and only act as a safety net if that migration has not been applied.
async function ensureFieldTables(db) {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      boundary_geojson TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      pins_geojson TEXT,
      status TEXT CHECK(status IN ('planned', 'in_progress', 'completed', 'cancelled')) DEFAULT 'planned',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
    )`
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS field_amendments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      treatment TEXT NOT NULL,
      operator TEXT DEFAULT 'Operator',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
    )`
  );
}

// Adds any telemetry column the app writes to but the migrations did not create
// (the V3/V4 migrations disagree on mission_id, and none of them add `overall`).
async function ensureTelemetryColumns(db) {
  const columns = await db.select('PRAGMA table_info(telemetry)');
  const existing = new Set(columns.map((c) => c.name));
  const wanted = {
    plot: 'TEXT',
    mission_id: 'TEXT',
    overall: 'REAL',
    nitrogen: 'REAL',
    phosphorus: 'REAL',
    potassium: 'REAL'
  };
  for (const [name, type] of Object.entries(wanted)) {
    if (!existing.has(name)) {
      await db.execute(`ALTER TABLE telemetry ADD COLUMN ${name} ${type}`);
    }
  }
}

// One-time import of telemetry logged before fields/missions were tables
// (mission_id like 'MSN-001', plot = field name). Each legacy mission becomes a
// completed mission row whose pins are its sample positions; its samples are
// re-pointed to the new mission id. Fields are created without a boundary.
async function backfillLegacyTelemetry(db) {
  const legacy = await db.select(
    `SELECT mission_id, MIN(plot) AS plot, MIN(timestamp) AS first_ts
     FROM telemetry
     WHERE CAST(mission_id AS TEXT) LIKE 'MSN-%'
     GROUP BY mission_id`
  );

  for (const row of legacy) {
    const fieldName = row.plot || 'Main Field';
    const found = await db.select('SELECT id FROM fields WHERE LOWER(name) = LOWER($1)', [fieldName]);
    let fieldId = found[0]?.id;
    if (!fieldId) {
      const inserted = await db.execute('INSERT INTO fields (name, boundary_geojson) VALUES ($1, NULL)', [fieldName]);
      fieldId = inserted.lastInsertId;
    }

    const points = await db.select(
      'SELECT latitude, longitude FROM telemetry WHERE mission_id = $1 ORDER BY timestamp ASC',
      [row.mission_id]
    );
    const pins = points
      .filter((p) => p.latitude !== null && p.longitude !== null)
      .map((p) => [p.latitude, p.longitude]);

    const mission = await db.execute(
      `INSERT INTO missions (field_id, name, mission_date, pins_geojson, status)
       VALUES ($1, $2, $3, $4, 'completed')`,
      [
        fieldId,
        `${fieldName} scan (${row.mission_id})`,
        String(row.first_ts || '').slice(0, 10) || new Date().toLocaleDateString('en-CA'),
        pinsToGeoJSON(pins)
      ]
    );

    await db.execute('UPDATE telemetry SET mission_id = $1 WHERE mission_id = $2', [
      String(mission.lastInsertId),
      row.mission_id
    ]);
  }
}

function rowToField(row, missionCount = 0) {
  return {
    id: row.id,
    name: row.name,
    boundary: geoJSONToBoundary(row.boundary_geojson),
    missionCount
  };
}

function rowToMission(row, sampleCount = 0) {
  return {
    id: row.id,
    fieldId: row.field_id,
    fieldName: row.field_name,
    name: row.name,
    date: String(row.mission_date || '').slice(0, 10),
    status: row.status,
    waypoints: geoJSONToPins(row.pins_geojson),
    sampleCount
  };
}

export async function fetchFields() {
  try {
    const db = await initDatabase();
    const rows = await db.select(
      `SELECT f.*, (SELECT COUNT(*) FROM missions m WHERE m.field_id = f.id) AS mission_count
       FROM fields f ORDER BY LOWER(f.name) ASC`
    );
    return rows.map((row) => rowToField(row, row.mission_count));
  } catch (error) {
    console.error('Failed to fetch fields:', error);
    return [];
  }
}

// Returns { field } on success or { error } with a message the UI can show.
export async function createField({ name, boundary }) {
  try {
    const db = await initDatabase();
    const trimmed = String(name || '').trim();
    if (!trimmed) return { error: 'Field name cannot be empty.' };

    const clash = await db.select('SELECT id FROM fields WHERE LOWER(name) = LOWER($1)', [trimmed]);
    if (clash.length > 0) return { error: `A field named "${trimmed}" already exists.` };

    const inserted = await db.execute(
      'INSERT INTO fields (name, boundary_geojson) VALUES ($1, $2)',
      [trimmed, boundaryToGeoJSON(boundary)]
    );
    const rows = await db.select('SELECT * FROM fields WHERE id = $1', [inserted.lastInsertId]);
    return { field: rowToField(rows[0]) };
  } catch (error) {
    console.error('Failed to create field:', error);
    return { error: 'Could not save the field to the database.' };
  }
}

export async function updateFieldBoundary(id, boundary) {
  try {
    const db = await initDatabase();
    await db.execute(
      'UPDATE fields SET boundary_geojson = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [boundaryToGeoJSON(boundary), id]
    );
    const rows = await db.select(
      `SELECT f.*, (SELECT COUNT(*) FROM missions m WHERE m.field_id = f.id) AS mission_count
       FROM fields f WHERE f.id = $1`,
      [id]
    );
    return rows[0] ? rowToField(rows[0], rows[0].mission_count) : null;
  } catch (error) {
    console.error('Failed to update field boundary:', error);
    return null;
  }
}

// Telemetry stores the field name in `plot`, so a rename must update both tables.
export async function renameField(id, newName) {
  try {
    const db = await initDatabase();
    const rows = await db.select('SELECT name FROM fields WHERE id = $1', [id]);
    if (!rows[0]) return null;
    await db.execute('UPDATE fields SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newName, id]);
    await db.execute('UPDATE telemetry SET plot = $1 WHERE plot = $2', [newName, rows[0].name]);
    return true;
  } catch (error) {
    console.error('Failed to rename field:', error);
    return null;
  }
}

// Only fields with no missions can be removed (their samples would be orphaned).
export async function deleteField(id) {
  try {
    const db = await initDatabase();
    const used = await db.select('SELECT COUNT(*) AS total FROM missions WHERE field_id = $1', [id]);
    if (used[0]?.total > 0) return null;
    await db.execute('DELETE FROM fields WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('Failed to delete field:', error);
    return null;
  }
}

export async function fetchMissions() {
  try {
    const db = await initDatabase();
    const rows = await db.select(
      `SELECT m.*, f.name AS field_name
       FROM missions m JOIN fields f ON f.id = m.field_id
       ORDER BY m.mission_date DESC, m.id DESC`
    );
    const counts = await db.select('SELECT mission_id, COUNT(*) AS total FROM telemetry GROUP BY mission_id');
    const countById = Object.fromEntries(counts.map((c) => [String(c.mission_id), c.total]));
    return rows.map((row) => rowToMission(row, countById[String(row.id)] || 0));
  } catch (error) {
    console.error('Failed to fetch missions:', error);
    return [];
  }
}

// New missions start as 'in_progress' (the operator launches them immediately).
export async function createMission({ fieldId, name, date, pins }) {
  try {
    const db = await initDatabase();
    const inserted = await db.execute(
      `INSERT INTO missions (field_id, name, mission_date, pins_geojson, status)
       VALUES ($1, $2, $3, $4, 'in_progress')`,
      [fieldId, String(name).trim(), date, pinsToGeoJSON(pins)]
    );
    const rows = await db.select(
      `SELECT m.*, f.name AS field_name
       FROM missions m JOIN fields f ON f.id = m.field_id WHERE m.id = $1`,
      [inserted.lastInsertId]
    );
    return rows[0] ? rowToMission(rows[0], 0) : null;
  } catch (error) {
    console.error('Failed to create mission:', error);
    return null;
  }
}

// status: 'planned' | 'in_progress' | 'completed' | 'cancelled'
export async function updateMissionStatus(id, status) {
  try {
    const db = await initDatabase();
    await db.execute(
      'UPDATE missions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, id]
    );
    return true;
  } catch (error) {
    console.error('Failed to update mission status:', error);
    return null;
  }
}

// Every georeferenced sample across every mission on this field ("merged"
// soil records) — used for the field's average readings and its full-history
// heatmap layer. Short-key shape matches fetchMissionSamples.
export async function fetchFieldSamples(fieldId) {
  try {
    const db = await initDatabase();
    const rows = await db.select(
      `SELECT t.* FROM telemetry t
       JOIN missions m ON CAST(t.mission_id AS TEXT) = CAST(m.id AS TEXT)
       WHERE m.field_id = $1 AND t.latitude IS NOT NULL AND t.longitude IS NOT NULL
       ORDER BY t.timestamp ASC`,
      [fieldId]
    );
    return rows.map((row) => ({
      ...row,
      lat: row.latitude,
      lng: row.longitude,
      coords: [row.latitude, row.longitude],
      n: row.nitrogen,
      p: row.phosphorus,
      k: row.potassium
    }));
  } catch (error) {
    console.error('Failed to fetch field samples:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Field amendments / treatments (merged Soil Records panel)
// ---------------------------------------------------------------------------
export async function fetchFieldAmendments(fieldId) {
  try {
    const db = await initDatabase();
    return await db.select(
      'SELECT * FROM field_amendments WHERE field_id = $1 ORDER BY date DESC, id DESC',
      [fieldId]
    );
  } catch (error) {
    console.error('Failed to fetch field amendments:', error);
    return [];
  }
}

export async function createFieldAmendment({ fieldId, date, treatment, operator }) {
  try {
    const db = await initDatabase();
    const trimmed = String(treatment || '').trim();
    if (!trimmed) return null;
    await db.execute(
      `INSERT INTO field_amendments (field_id, date, treatment, operator)
       VALUES ($1, $2, $3, $4)`,
      [fieldId, date || new Date().toISOString().slice(0, 10), trimmed, operator || 'Operator']
    );
    return await fetchFieldAmendments(fieldId);
  } catch (error) {
    console.error('Failed to save field amendment:', error);
    return null;
  }
}