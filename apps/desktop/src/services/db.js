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