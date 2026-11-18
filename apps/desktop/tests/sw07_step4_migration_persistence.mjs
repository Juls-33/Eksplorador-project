// MTP-SW-07 Step 4: migration-backed SQLite close/reopen persistence test.
// Runs Node.js 24+ from the Eksplorador project root. NEVER opens eksplorer production DB.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const migrationDir = path.join(root, 'apps', 'desktop', 'src-tauri', 'migrations');
const productionPath = path.resolve(root, 'apps', 'desktop', 'src-tauri', 'eksplorador.db');
const dir = mkdtempSync(path.join(tmpdir(), 'eksplorador-sw07-step4-'));
const dbPath = path.join(dir, 'sw07-temporary.db');
const evidenceDir = mkdtempSync(path.join(tmpdir(), 'eksplorador-sw07-evidence-'));
const migrationFiles = [
  'V1__create_telemetry_table.sql',
  'V2__add_npk_columns.sql',
  'V4__add_mission_and_audit_timestamps.sql',
  'V5__create_additional_tables.sql',
  'V6__rebuild_telemetry_schema.sql'
];
let db;
const checks = [];
const pass = (message) => { checks.push(message); console.log('PASS:', message); };
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);

try {
  assert.notEqual(path.resolve(dbPath), productionPath);
  for (const filename of migrationFiles) {
    const file = path.join(migrationDir, filename);
    const sql = readFileSync(file, 'utf8');
    if (!sql.trim()) throw new Error(`Empty migration: ${filename}`);
  }

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  for (const filename of migrationFiles) {
    try {
      db.exec(readFileSync(path.join(migrationDir, filename), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${filename} failed in clean temporary database: ${error.message}. Do not modify the production database to compensate.`);
    }
  }
  pass('Actual V1/V2/V4/V5/V6 migration SQL applied to a temporary SQLite file');

  // database_support.sql is invoked by database::ensure_schema() in the native app.
  // We can execute its SQL, but do NOT claim this calls the complete Rust ensure_schema() logic.
  const supportPath = path.join(migrationDir, 'database_support.sql');
  db.exec(readFileSync(supportPath, 'utf8'));
  pass('Actual database_support.sql executed in temporary SQLite file');

  const fieldCols = columns('fields');
  const missionCols = columns('missions');
  const telemetryCols = columns('telemetry');
  for (const col of ['id','name','boundary_geojson']) assert.ok(fieldCols.includes(col), `fields.${col} missing`);
  for (const col of ['id','field_id','name','pins_geojson']) assert.ok(missionCols.includes(col), `missions.${col} missing`);
  for (const col of ['id','mission_id','latitude','longitude','moisture','ph','ec','nitrogen','phosphorus','potassium']) assert.ok(telemetryCols.includes(col), `telemetry.${col} missing`);
  pass('Expected field, mission, and soil measurement columns exist');

  const boundary = JSON.stringify({type:'Polygon',coordinates:[[
    [120.9892,14.6094],[120.9898,14.6094],[120.9897,14.6099],[120.9892,14.6094]
  ]]});
  const pins = JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{order:1},geometry:{type:'Point',coordinates:[120.9895,14.6096]}}]});
  db.prepare('INSERT INTO fields (name, boundary_geojson) VALUES (?, ?)').run('SW07 Persistence Field',boundary);
  const fieldId = Number(db.prepare("SELECT id FROM fields WHERE name = 'SW07 Persistence Field'").get().id);
  db.prepare('INSERT INTO missions (field_id,name,mission_date,pins_geojson,status) VALUES (?,?,?,?,?)')
    .run(fieldId,'SW07 Persistence Mission','2026-11-18',pins,'in_progress');
  const missionId = Number(db.prepare('SELECT id FROM missions WHERE field_id = ?').get(fieldId).id);

  const optionalColumns = [];
  const optionalValues = [];
  if (telemetryCols.includes('plot')) { optionalColumns.push('plot'); optionalValues.push('SW07 Persistence Field'); }
  if (telemetryCols.includes('sample_session_id')) { optionalColumns.push('sample_session_id'); optionalValues.push('sw07-test-session-1'); }
  if (telemetryCols.includes('location_source')) { optionalColumns.push('location_source'); optionalValues.push('GPS'); }
  const insertCols = ['mission_id','timestamp','latitude','longitude','moisture','ph','ec','nitrogen','phosphorus','potassium', ...optionalColumns];
  const params = [missionId,'2026-11-18T12:00:00Z',14.6096,120.9895,36.5,6.8,420,20,15,40,...optionalValues];
  db.prepare(`INSERT INTO telemetry (${insertCols.join(',')}) VALUES (${insertCols.map(()=>'?').join(',')})`).run(...params);
  const telemetryId = Number(db.prepare('SELECT id FROM telemetry WHERE mission_id = ?').get(missionId).id);
  db.close(); db = undefined;
  pass('Synthetic field, boundary, mission, and sample written then database closed');

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  const record = db.prepare(`SELECT f.id AS field_id, f.name AS field_name, f.boundary_geojson,
    m.id AS mission_id, m.name AS mission_name, m.pins_geojson,
    t.id AS telemetry_id, t.moisture, t.ph, t.ec, t.latitude, t.longitude,
    t.nitrogen, t.phosphorus, t.potassium
    FROM fields f JOIN missions m ON m.field_id=f.id
    JOIN telemetry t ON t.mission_id=m.id WHERE f.id=? AND m.id=? AND t.id=?`)
    .get(fieldId,missionId,telemetryId);
  assert.ok(record, 'Joined field/mission/sample missing after reopen');
  assert.equal(record.field_name,'SW07 Persistence Field');
  assert.equal(record.mission_name,'SW07 Persistence Mission');
  pass('Field–mission–sample relationships survived database reopen');
  assert.deepEqual(JSON.parse(record.boundary_geojson), JSON.parse(boundary));
  assert.deepEqual(JSON.parse(record.pins_geojson),JSON.parse(pins));
  pass('Saved GeoJSON boundary and waypoint survived database reopen');
  for (const [key,expected] of Object.entries({moisture:36.5,ph:6.8,ec:420,latitude:14.6096,longitude:120.9895,nitrogen:20,phosphorus:15,potassium:40})) {
    assert.equal(record[key],expected,`Mismatch in ${key}`);
  }
  pass('Measured soil values, NPK, and coordinates survived database reopen');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  pass('SQLite foreign-key and database integrity checks passed');

  const evidence = {
    test:'MTP-SW-07 Step 4 — migration-backed persistence (not a native Tauri restart)',
    timestamp:new Date().toISOString(),
    migrations:migrationFiles,
    checks,
    fieldId, missionId, telemetryId,
    saved:record,
    note:'Uses real migration SQL plus database_support.sql, but does not invoke Rust database::ensure_schema or restart native Tauri.'
  };
  const evidencePath = path.join(evidenceDir,'sw07_step4_evidence.json');
  writeFileSync(evidencePath,JSON.stringify(evidence,null,2));
  console.log(`SW07 Step 4 migration-backed checks: ${checks.length}/${checks.length} PASS`);
  console.log('Evidence:',evidencePath);
} catch (error) {
  console.error('SW07 Step 4 FAILED:',error.message);
  process.exitCode=1;
} finally {
  try { db?.close(); } catch {}
  rmSync(dir,{recursive:true,force:true});
  // Evidence folder deliberately retained; database folder is always deleted.
}
