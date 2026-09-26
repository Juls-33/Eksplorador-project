import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

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
      return db;
    });
  }
  return dbPromise;
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