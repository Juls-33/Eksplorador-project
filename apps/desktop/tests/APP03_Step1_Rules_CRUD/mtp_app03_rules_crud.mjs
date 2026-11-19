// MTP-APP-03: direct compatibility rule vectors + temporary-SQLite crop-profile CRUD.
// Node.js 24+. Run from the Eksplorador-project repository root.
// IMPORTANT: This test never opens src-tauri/eksplorador.db and never calls Tauri or hardware.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const compatibilityFile = path.join(root,'apps','desktop','src','utils','cropCompatibility.js');
const dbServiceFile = path.join(root,'apps','desktop','src','services','db.js');
const supportFile = path.join(root,'apps','desktop','src-tauri','migrations','database_support.sql');
const rustSchemaFile = path.join(root,'apps','desktop','src-tauri','src','database.rs');
const originalDb = path.join(root,'apps','desktop','src-tauri','eksplorador.db');
const tempDir = mkdtempSync(path.join(tmpdir(),'eksplorador-app03-'));
const tempDb = path.join(tempDir,'app03-test-only.db');
const evidence = { test:'MTP-APP-03 Step 1 — actual compatibility module and database-profile SQL',
  started:new Date().toISOString(), temporaryDatabase:tempDb,
  limitations:'Direct JS function plus actual source-extracted UPSERT SQL in isolated SQLite; no browser UI, live crop-card recommendations, native Tauri service, real field validation, or persisted production data tested.',checks:[],vectors:[] };
let db;
const pass = (msg) => { evidence.checks.push(msg); console.log('PASS:',msg); };
function oracle(sample, th, soilType, soils) {
  const numeric = v => v!==null && v!==undefined && typeof v!=='boolean' && !(typeof v==='string' && !v.trim()) && Number.isFinite(Number(v));
  const phValid = numeric(sample?.ph) && numeric(th?.minPh) && numeric(th?.maxPh) && Number(th.minPh)<Number(th.maxPh) && Number(sample.ph)>=0 && Number(sample.ph)<=14;
  if (!phValid) return 'insufficient';
  const outside = Number(sample.ph)<Number(th.minPh) || Number(sample.ph)>Number(th.maxPh);
  const soilMismatch = Boolean(soilType && soils?.length && !soils.includes(soilType));
  return outside || soilMismatch ? 'review' : 'matched';
}
const vectors=[];
function add(group, ph, lo, hi, soilType='', soils=[]) {
  vectors.push({group, sample:{ph},thresholds:{minPh:lo,maxPh:hi},soilType,soils});
}
// 50 independent predetermined cases: 10 lower/upper edges, 10 soil contexts,
// 10 missing/invalid, 10 in/out ranges, 10 crop-named rule-profile examples.
for (const ph of [5.49,5.5,5.51,6.49,6.5,6.51,6.99,7,7.01,8]) add('boundary',ph,5.5,7);
for (const [soil,preferred] of [
  ['loam',['loam']],['clay',['loam']],['sandy-loam',['loam','sandy-loam']],
  ['silt-loam',['loam']],['',['loam']],['clay',[]],['loam',[]],
  ['sandy-loam',['sandy-loam']],['clay-loam',['loam','clay-loam']],['loam',['clay']]
]) add('soil-context',6.2,5.5,7,soil,preferred);
for (const [ph,lo,hi] of [
  [null,5,7],[undefined,5,7],['',5,7],['n/a',5,7],[true,5,7],
  [-1,5,7],[14.01,5,7],[6,7,5],[6,null,7],[6,5,null]
]) add('missing-invalid',ph,lo,hi);
for (const ph of [0,1,4.9,5,5.01,6,7,7.01,13.99,14]) add('general-range',ph,5,7);
// Named cases label only the pH profile; they are not assertions of agronomic validity.
for (const [group,ph,lo,hi] of [
  ['rice',5.49,5.5,7],['rice',5.5,5.5,7],['rice',7,5.5,7],['rice',7.01,5.5,7],
  ['cacao',5.49,5.5,6.7],['cacao',5.5,5.5,6.7],['cacao',6.7,5.5,6.7],['cacao',6.71,5.5,6.7],
  ['custom',6.8,5.5,6.5],['custom',6.8,5.5,7]
]) add('profile-'+group,ph,lo,hi);
assert.equal(vectors.length,50);
try {
  assert.notEqual(path.resolve(tempDb),path.resolve(originalDb));
  const {evaluateCropCompatibility,summarizeCropCompatibility} = await import(pathToFileURL(compatibilityFile).href);
  let matches=0;
  for (const [i,v] of vectors.entries()) {
    const expected=oracle(v.sample,v.thresholds,v.soilType,v.soils);
    const result=evaluateCropCompatibility(v.sample,v.thresholds,v.soilType,v.soils);
    const ok=result.status===expected;
    if(ok) matches++;
    else console.error('MISMATCH:',i+1,v.group,'expected',expected,'actual',result.status);
    evidence.vectors.push({id:i+1,group:v.group,sample:v.sample,thresholds:v.thresholds,soilType:v.soilType,preferred:v.soils,expected,actual:result.status,pass:ok});
  }
  evidence.agreement={matches,total:vectors.length,percent:100*matches/vectors.length};
  console.log(`Rule agreement: ${matches}/${vectors.length} (${evidence.agreement.percent.toFixed(1)}%)`);
  assert.ok(evidence.agreement.percent>=90,'Below MTP-APP-03 90% rule agreement');
  assert.equal(matches,vectors.length,'One or more rule vectors mismatched');
  pass('50 independent compatibility rule vectors match actual cropCompatibility.js (pH, soil type, missing and boundaries)');
  const s=summarizeCropCompatibility([{ph:6.8},{ph:6.2},{ph:null}],{minPh:5.5,maxPh:6.5},'loam',['loam']);
  assert.deepEqual({total:s.counts.total,matched:s.counts.matched,review:s.counts.review,insufficient:s.counts.insufficient},{total:3,matched:1,review:1,insufficient:1});
  pass('Actual compatibility summary distinguishes matched, review and insufficient');

  // Pull the exact UPSERT SQL from the application source; no copied/rewritten SQL.
  const source=readFileSync(dbServiceFile,'utf8');
  const sql=source.match(/async function upsertCropProfile\s*\([\s\S]*?await db\.execute\(\s*`([\s\S]*?)`\s*,/i)?.[1];
  assert.ok(sql?.includes('ON CONFLICT(id) DO UPDATE SET'),'Could not extract application UPSERT SQL');
  const support=readFileSync(supportFile,'utf8');
  const createCrop=support.match(/CREATE TABLE IF NOT EXISTS crop_profiles\s*\([\s\S]*?\);/i)?.[0];
  assert.ok(createCrop,'Could not extract actual crop_profiles CREATE TABLE statement');
  db=new DatabaseSync(tempDb); db.exec('PRAGMA foreign_keys=ON;'); db.exec(createCrop);
  // Match the additional schema step used by Rust database::ensure_schema().
  // V5 / database_support.sql creates crop_profiles without this later column.
  // Verify that the project really defines this migration before reproducing it
  // in our disposable SQLite file. No application/database source is modified.
  const rustSchema = readFileSync(rustSchemaFile,'utf8');
  assert.match(rustSchema, /if\s*!crop_info\.iter\(\)\.any\([^)]*\|c\|\s*c\[\"name\"\]\s*==\s*\"compatible_soil_types\"\)/,
    'Cannot verify Rust ensure_schema checks compatible_soil_types');
  const soilTypeMigration = rustSchema.match(/ALTER TABLE crop_profiles ADD COLUMN compatible_soil_types TEXT DEFAULT NULL\s*;/)?.[0];
  assert.ok(soilTypeMigration, 'Rust ensure_schema no longer contains the expected crop-profile ALTER TABLE');
  db.exec(soilTypeMigration);
  assert.ok(db.prepare('PRAGMA table_info(crop_profiles)').all().some(c => c.name === 'compatible_soil_types'));
  pass('TEST SETUP: reproduced Rust ensure_schema crop-profile soil-type column on temporary database');
  function params(maxPh,notes='APP03 isolated test') { return [
    'CRP-APP03-TEST','APP03 Synthetic Crop','Tree Crop',5.5,maxPh,20,80,0.5,2.0,10,50,10,50,10,50,notes,JSON.stringify(['loam'])
  ]; }
  const stmt=db.prepare(sql);
  // Node node:sqlite treats SQLite $1..$17 as named placeholders, not positional ? bindings.
  // Bind the application SQL unchanged, using its explicit parameter names.
  const namedParams = values => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
  stmt.run(namedParams(params(6.5)));
  const created=db.prepare('SELECT * FROM crop_profiles WHERE id=?').get('CRP-APP03-TEST');
  assert.equal(created.name,'APP03 Synthetic Crop'); assert.equal(created.max_ph,6.5);
  pass('CREATE/READ: actual db.js UPSERT SQL stored synthetic profile in separate SQLite file');
  let outcome=evaluateCropCompatibility({ph:6.8},{minPh:created.min_ph,maxPh:created.max_ph},'loam',JSON.parse(created.compatible_soil_types));
  assert.equal(outcome.status,'review');
  stmt.run(namedParams(params(7,'APP03 threshold edited')));
  const updated=db.prepare('SELECT * FROM crop_profiles WHERE id=?').get('CRP-APP03-TEST');
  assert.equal(updated.max_ph,7); assert.equal(updated.notes,'APP03 threshold edited');
  outcome=evaluateCropCompatibility({ph:6.8},{minPh:updated.min_ph,maxPh:updated.max_ph},'loam',JSON.parse(updated.compatible_soil_types));
  assert.equal(outcome.status,'matched');
  pass('UPDATE: actual UPSERT changed pH threshold and changed assessment from review to matched');
  db.close();db=undefined;
  db=new DatabaseSync(tempDb); db.exec('PRAGMA foreign_keys=ON;');
  assert.equal(db.prepare('SELECT max_ph FROM crop_profiles WHERE id=?').get('CRP-APP03-TEST').max_ph,7);
  pass('PERSISTENCE: edited crop profile survived SQLite close/reopen');
  // Exactly the DELETE SQL and parameter behavior of deleteCropProfile().
  const deleteSql=source.match(/export async function deleteCropProfile\s*\([\s\S]*?db\.execute\(\s*'([^']*DELETE FROM crop_profiles[^']*)'/i)?.[1];
  assert.equal(deleteSql,'DELETE FROM crop_profiles WHERE id = $1','Could not extract actual DELETE SQL');
  // Match the named $1 placeholder in the application's DELETE SQL.
  db.prepare(deleteSql).run({ '$1': 'CRP-APP03-TEST' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crop_profiles WHERE id=?').get('CRP-APP03-TEST').n,0);
  pass('DELETE: actual db.js DELETE SQL removed the synthetic profile only');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  pass('Temporary SQLite integrity and foreign-key validation passed');
  evidence.status='PASS';
} catch(err) {
  evidence.status='FAIL';evidence.error=String(err?.stack||err);console.error('APP03 FAILED:',err?.message||err);
  process.exitCode=1;
} finally {
  if(db) db.close();
  evidence.finished=new Date().toISOString();
  const output=path.join(root,'apps','desktop','tests','mtp_app03_step1_evidence.json');
  try {writeFileSync(output,JSON.stringify(evidence,null,2));console.log('Evidence:',output)} catch(e) {console.error('Evidence write error:',e.message)}
  rmSync(tempDir,{recursive:true,force:true});
  console.log('Temporary database deleted. Production database never opened.');
}
