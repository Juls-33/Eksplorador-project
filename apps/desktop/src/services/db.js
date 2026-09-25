import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

let db = null;

export async function initDatabase() {
  if (!db) {
    db = await Database.load('sqlite:eksplorador.db');
    await db.execute(
      'CREATE TABLE IF NOT EXISTS telemetry (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ' +
        'latitude REAL, longitude REAL, moisture REAL, ph REAL, ec REAL, ' +
        'nitrogen REAL, phosphorus REAL, potassium REAL, ' +
        'soil_valid INTEGER DEFAULT 1)'
    );
  }
  return db;
}

export async function insertReading(reading) {
  const database = await initDatabase();
  return await database.execute(
    'INSERT INTO sensor_readings ' +
      '(latitude, longitude, moisture, temperature, nitrogen, phosphorus, potassium) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      reading.latitude,
      reading.longitude,
      reading.moisture,
      reading.temperature,
      reading.nitrogen,
      reading.phosphorus,
      reading.potassium
    ]
  );
}

export async function getHeatmapPoints(parameter = 'moisture') {
  const database = await initDatabase();
  const rows = await database.select(
    'SELECT latitude, longitude, ' + parameter +
    ' AS intensity FROM sensor_readings WHERE latitude IS NOT NULL AND longitude IS NOT NULL'
  );
  return rows.map(r => [r.latitude, r.longitude, r.intensity || 0.5]);
}

export async function saveSoilSample(sample) {
  try {
    const key = 'samples_' + sample.mission_id;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push(sample);
    localStorage.setItem(key, JSON.stringify(existing));
    return true;
  } catch (error) {
    console.error('Failed to save soil sample:', error);
    return null;
  }
}

export async function fetchMissionSamples(missionId) {
  try {
    const data = localStorage.getItem('samples_' + missionId);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to fetch mission samples:', error);
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