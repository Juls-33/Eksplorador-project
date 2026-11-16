// Safe compatibility adapter for Eksplorador v2 backups created before the
// soil-sampling extension. Only the three known, additive schema changes are
// migrated. Unknown schema differences are rejected by the native validator.
const ADDED_COLUMNS = {
  fields: ['soil_type'],
  crop_profiles: ['compatible_soil_types'],
  telemetry: ['sample_session_id']
};
export function extendLegacySoilBackup(packageData, live) {
  const result = structuredClone(packageData);
  if (!result || result.format !== 'eksplorador.database' || result.version !== 2 || !result.tables) return result;
  for (const [name, columns] of Object.entries(ADDED_COLUMNS)) {
    const incoming = result.tables[name], target = live.tables[name];
    if (!incoming || !target) continue;
    const existingNames = new Set(incoming.columns.map(c => c.name));
    for (const col of columns) {
      const missing = !existingNames.has(col);
      const expectedColumn = target.columns.find(c => c.name === col);
      if (missing && expectedColumn) {
        incoming.columns.push(structuredClone(expectedColumn));
        for (const row of incoming.rows) row[col] = null;
      }
    }
  }
  if (!result.tables.mission_soil_readings && live.tables.mission_soil_readings) {
    result.tables.mission_soil_readings = {
      ...structuredClone(live.tables.mission_soil_readings),
      rows: []
    };
  }
  return result;
}
