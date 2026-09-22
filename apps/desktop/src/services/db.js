import Database from '@tauri-apps/plugin-sql';

let db = null;

export async function initDatabase() {
  if (!db) {
    db = await Database.load('sqlite:eksplorador.db');
    
    // Create telemetry & sensor readings table for GIS heatmap points
    await db.execute(`
      CREATE TABLE IF NOT EXISTS sensor_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        moisture REAL,
        temperature REAL,
        nitrogen REAL,
        phosphorus REAL,
        potassium REAL
      );
    `);
  }
  return db;
}

export async function insertReading(reading) {
  const database = await initDatabase();
  return await database.execute(
    `INSERT INTO sensor_readings 
      (latitude, longitude, moisture, temperature, nitrogen, phosphorus, potassium) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
    `SELECT latitude, longitude, ${parameter} AS intensity FROM sensor_readings WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
  );
  // Leaflet.heat expects [lat, lng, intensity]
  return rows.map(r => [r.latitude, r.longitude, r.intensity || 0.5]);
}

/**
 * Saves a new soil sample to SQLite / storage
 * @param {Object} sample Sample object containing telemetry data
 */
export async function saveSoilSample(sample) {
  try {
    // If using Tauri SQL plugin:
    // const db = await Database.load('sqlite:soil_app.db');
    // return await db.execute(
    //   `INSERT INTO soil_samples (mission_id, lat, lng, moisture, ph, ec, nitrogen, phosphorus, potassium, overall, timestamp) 
    //    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    //   [sample.mission_id, sample.lat, sample.lng, sample.moisture, sample.ph, sample.ec, sample.n || sample.nitrogen, sample.p || sample.phosphorus, sample.k || sample.potassium, sample.overall, sample.timestamp]
    // );

    // Fallback/In-memory store example:
    const existing = JSON.parse(localStorage.getItem(`samples_${sample.mission_id}`) || '[]');
    existing.push(sample);
    localStorage.setItem(`samples_${sample.mission_id}`, JSON.stringify(existing));
    return true;
  } catch (error) {
    console.error('Failed to save soil sample:', error);
    return null;
  }
}

/**
 * Fetches recorded soil samples for a specific mission
 * @param {string} missionId Mission ID to fetch samples for
 * @returns {Array} Array of soil sample records
 */
export async function fetchMissionSamples(missionId) {
  try {
    // If using Tauri SQL plugin:
    // const db = await Database.load('sqlite:soil_app.db');
    // return await db.select('SELECT * FROM soil_samples WHERE mission_id = $1', [missionId]);

    // Fallback/In-memory store example:
    const data = localStorage.getItem(`samples_${missionId}`);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to fetch mission samples:', error);
    return [];
  }
}