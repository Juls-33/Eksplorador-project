/**
 * Built-in Arabica coffee profile regression.
 * Execute with `node --test apps/desktop/tests/arabicaCoffeeProfile.regression.test.mjs`.
 * All database operations use isolated in-memory SQLite and NEVER touch eksplorador.db.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BUILTIN_CROP_REFERENCES } from '../src/utils/cropReferences.js';
import { evaluateCropCompatibility } from '../src/utils/cropCompatibility.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbService = readFileSync(resolve(here, '../src/services/db.js'), 'utf8');
const schema = readFileSync(resolve(here, '../src-tauri/migrations/database_support.sql'), 'utf8');

// The Tauri bridge is not usable under Node. Evaluate the actual profile and
// seeding/upsert functions from db.js without their imports or touching the app DB.
const noImports = dbService.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm, '');
const source = noImports.replace(/^export\s+/gm, '');
const service = new Function('BUILTIN_CROP_REFERENCES',
  `${source}\nreturn {REQUIRED_ARABICA_COFFEE_PROFILE, REQUIRED_CACAO_PROFILE, seedDefaultCropProfiles, ensureCacaoAndSoilReferenceDefaults, upsertCropProfile};`
)(BUILTIN_CROP_REFERENCES);

const createDb = () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(schema);
  sql.exec('ALTER TABLE crop_profiles ADD COLUMN compatible_soil_types TEXT DEFAULT NULL;');
  const values = (statement, params) => sql.prepare(statement.replace(/\$(\d+)/g, '?'));
  return {
    raw: sql,
    select: async (statement, params=[]) => values(statement, params).all(...params),
    execute: async (statement, params=[]) => values(statement, params).run(...params)
  };
};

const getCrop = (db, id=service.REQUIRED_ARABICA_COFFEE_PROFILE.id) =>
  db.select('SELECT * FROM crop_profiles WHERE id = $1', [id]).then(rows=>rows[0]);

test('CRP-COFFEE-01: default Arabica values and agricultural citation are defined', () => {
  const crop=service.REQUIRED_ARABICA_COFFEE_PROFILE;
  assert.equal(crop.id,'CRP-COFFEE-ARABICA');
  assert.equal(crop.name,'Arabica Coffee (Coffea arabica)');
  assert.equal(crop.category,'Tree Crop');
  assert.deepEqual([crop.thresholds.minPh,crop.thresholds.maxPh],[5.6,6.5]);
  assert.deepEqual(crop.compatibleSoilTypes,['sandy-loam','loam','clay-loam']);
  assert.match(BUILTIN_CROP_REFERENCES[crop.id].url,/da\.gov\.ph/);
  assert.match(crop.notes,/drainage are not assessed/i);
});

test('CRP-COFFEE-02: fresh database seeds one Arabica alongside the existing profiles', async () => {
  const db=createDb();
  try {
    await service.seedDefaultCropProfiles(db);
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    const all=await db.select('SELECT * FROM crop_profiles');
    assert.equal(all.length,6,'four existing profiles + Cacao + Arabica');
    const arabica=await getCrop(db);
    assert.equal(arabica.name,service.REQUIRED_ARABICA_COFFEE_PROFILE.name);
    assert.deepEqual([arabica.min_ph,arabica.max_ph],[5.6,6.5]);
    assert.deepEqual(JSON.parse(arabica.compatible_soil_types),service.REQUIRED_ARABICA_COFFEE_PROFILE.compatibleSoilTypes);
    assert.equal((await db.select("SELECT value FROM _app_meta WHERE key='crop_defaults_seeded'"))[0].value,'1');
  } finally { db.raw.close(); }
});

test('CRP-COFFEE-03: upgrade includes Arabica even when prior crop-reference upgrade completed', async () => {
  const db=createDb();
  try {
    await service.seedDefaultCropProfiles(db);
    await db.execute("INSERT INTO _app_meta(key,value) VALUES('crop_reference_upgrade_v1','1')");
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    assert.equal((await getCrop(db)).name,service.REQUIRED_ARABICA_COFFEE_PROFILE.name);
  } finally { db.raw.close(); }
});

test('CRP-COFFEE-04: repeated initialization is idempotent and does not duplicate Arabica', async () => {
  const db=createDb();
  try {
    await service.seedDefaultCropProfiles(db);
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    assert.equal((await db.select("SELECT COUNT(*) AS total FROM crop_profiles WHERE id='CRP-COFFEE-ARABICA'"))[0].total,1);
    assert.equal((await db.select('SELECT COUNT(*) AS total FROM crop_profiles'))[0].total,6);
  } finally { db.raw.close(); }
});

test('CRP-COFFEE-05: user edits to the built-in Arabica crop are never overwritten', async () => {
  const db=createDb();
  try {
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    await db.execute('UPDATE crop_profiles SET min_ph=$1, max_ph=$2, notes=$3, compatible_soil_types=$4 WHERE id=$5',
      [5.1,6.2,'Locally adjusted',JSON.stringify(['loam']),'CRP-COFFEE-ARABICA']);
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    const crop=await getCrop(db);
    assert.deepEqual([crop.min_ph,crop.max_ph,crop.notes,JSON.parse(crop.compatible_soil_types)],[5.1,6.2,'Locally adjusted',['loam']]);
  } finally { db.raw.close(); }
});

test('CRP-COFFEE-06: existing Arabica-named custom profile is not duplicated', async () => {
  const db=createDb();
  try {
    await service.upsertCropProfile(db,{...service.REQUIRED_ARABICA_COFFEE_PROFILE,
      id:'CRP-021',name:'Arabica coffee (local farmer profile)'});
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    const matches=await db.select("SELECT id FROM crop_profiles WHERE LOWER(name) LIKE '%arabica%'");
    assert.deepEqual(matches.map(r=>r.id),['CRP-021']);
    assert.equal(await getCrop(db),undefined);
  } finally { db.raw.close(); }
});

test('CRP-COFFEE-07: screening follows existing pH bounds without new scoring rules', () => {
  const c=service.REQUIRED_ARABICA_COFFEE_PROFILE;
  const judge=(ph,soil='') => evaluateCropCompatibility({ph},c.thresholds,soil,c.compatibleSoilTypes);
  for(const ph of [5.6,6.0,6.5]) assert.equal(judge(ph,'loam').status,'matched');
  for(const ph of [5.59,6.51]) assert.equal(judge(ph,'loam').status,'review');
  assert.equal(judge(6.0,'sandy').status,'review');
  assert.equal(judge(null).status,'insufficient');
});

test('CRP-COFFEE-08: existing custom profile and prior built-in thresholds remain intact', async () => {
  const db=createDb();
  try {
    await service.seedDefaultCropProfiles(db);
    const original=await getCrop(db,'CRP-001');
    await service.upsertCropProfile(db,{...service.REQUIRED_ARABICA_COFFEE_PROFILE,id:'CRP-005',name:'Farmer custom crop'});
    await service.ensureCacaoAndSoilReferenceDefaults(db);
    assert.deepEqual([ (await getCrop(db,'CRP-001')).min_ph, (await getCrop(db,'CRP-001')).max_ph ],[original.min_ph,original.max_ph]);
    assert.equal((await getCrop(db,'CRP-005')).name,'Farmer custom crop');
    assert.equal((await getCrop(db)).name,service.REQUIRED_ARABICA_COFFEE_PROFILE.name);
  } finally { db.raw.close(); }
});
