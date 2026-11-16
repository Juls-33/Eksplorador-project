// Idempotent compatibility migration for existing desktop installations.
// The native database initializer normally adds these columns. Repeat the
// check in the frontend because an updated UI can also run with an older
// compiled Tauri backend (or an older database schema).
// Table/column identifiers are fixed, never taken from user input.
const REQUIRED_SOIL_COLUMNS = [
  ['fields', 'soil_type'],
  ['crop_profiles', 'compatible_soil_types']
];

export async function ensureSoilClassificationSchema(db) {
  for (const [table, column] of REQUIRED_SOIL_COLUMNS) {
    const info = await db.select(`PRAGMA table_info(${table})`);
    if (!info.length) {
      throw new Error(`Missing database table: ${table}`);
    }

    const present = info.some(entry =>
      String(entry.name).toLowerCase() === column
    );
    if (!present) {
      try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT DEFAULT NULL`);
      } catch (error) {
        // If another connection migrated it after our schema check, it is
        // safe to continue only when a new schema read proves it now exists.
        const updated = await db.select(`PRAGMA table_info(${table})`);
        if (!updated.some(entry => String(entry.name).toLowerCase() === column)) {
          throw error;
        }
      }
    }
  }
}
