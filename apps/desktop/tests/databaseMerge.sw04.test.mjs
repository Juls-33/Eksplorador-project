import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDatabasePackages } from '../src/utils/databaseMerge.js';

const column = (name, type, pk = false) => ({ name, data_type: type, required: false, primary_key: pk });
const fieldCols = [column('id', 'INTEGER', true), column('name', 'TEXT')];
const missionCols = [column('id', 'INTEGER', true), column('field_id', 'INTEGER'), column('name', 'TEXT')];
const telemetryCols = [column('id', 'INTEGER', true), column('mission_id', 'INTEGER'), column('ph', 'REAL')];

function fixture(sourceId, name, ph) {
  return {
    format: 'eksplorador.database', version: 2, source_id: sourceId,
    revision: 1, origins: [],
    sequences: { fields: 1, missions: 1, telemetry: 1 },
    tables: {
      fields: { columns: structuredClone(fieldCols), foreign_keys: [], rows: [{ id: 1, name }] },
      missions: { columns: structuredClone(missionCols),
        foreign_keys: [{ column: 'field_id', table: 'fields', target: 'id' }],
        rows: [{ id: 1, field_id: 1, name: `${name} Mission` }] },
      telemetry: { columns: structuredClone(telemetryCols),
        foreign_keys: [{ column: 'mission_id', table: 'missions', target: 'id' }],
        rows: [{ id: 1, mission_id: 1, ph }] },
    },
  };
}

function mergedPair() {
  return mergeDatabasePackages(
    fixture('SOURCE-A', 'Field A', 6.5),
    [fixture('SOURCE-B', 'Field B', 7.2)]
  );
}

test('SW04-STEP3A: overlapping primary keys remapped and both fields retained', async () => {
  const { data, added } = await mergedPair();
  assert.equal(added, 3);
  assert.equal(data.tables.fields.rows.length, 2);
  assert.deepEqual(new Set(data.tables.fields.rows.map(r => r.name)), new Set(['Field A', 'Field B']));
  assert.equal(new Set(data.tables.fields.rows.map(r => r.id)).size, 2);
});

test('SW04-STEP3B: mission and telemetry FKs remapped to their own source', async () => {
  const { data } = await mergedPair();
  const fields = new Map(data.tables.fields.rows.map(r => [r.id, r]));
  const missions = new Map(data.tables.missions.rows.map(r => [r.id, r]));
  for (const mission of missions.values()) {
    assert.equal(mission.name, `${fields.get(mission.field_id)?.name} Mission`);
  }
  for (const sensor of data.tables.telemetry.rows) {
    const mission = missions.get(sensor.mission_id);
    assert.ok(mission, 'telemetry must point to an existing mission');
    assert.equal(mission.name, sensor.ph === 6.5 ? 'Field A Mission' : 'Field B Mission');
  }
  assert.equal(data.tables.telemetry.rows.find(r => r.ph === 7.2).mission_id,
    data.tables.missions.rows.find(r => r.name === 'Field B Mission').id);
});

test('SW04-STEP3C: repeated merge of identical backup is idempotent', async () => {
  const incoming = fixture('SOURCE-B', 'Field B', 7.2);
  const first = await mergeDatabasePackages(fixture('SOURCE-A', 'Field A', 6.5), [incoming]);
  const second = await mergeDatabasePackages(first.data, [incoming]);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 3);
  assert.deepEqual(second.data.tables, first.data.tables);
});

test('SW04-STEP3D: unresolved foreign-key reference rejects full plan', async () => {
  const incoming = fixture('SOURCE-B', 'Field B', 7.2);
  incoming.tables.missions.rows[0].field_id = 999;
  const original = fixture('SOURCE-A', 'Field A', 6.5);
  const before = structuredClone(original);
  await assert.rejects(mergeDatabasePackages(original, [incoming]), /Missing fields reference/);
  assert.deepEqual(original, before, 'planner must not mutate current snapshot');
});

test('SW04-STEP3E: incompatible schema rejects without mutating input', async () => {
  const incoming = fixture('SOURCE-B', 'Field B', 7.2);
  incoming.tables.fields.columns.push(column('unexpected', 'TEXT'));
  const original = fixture('SOURCE-A', 'Field A', 6.5);
  const before = structuredClone(original);
  await assert.rejects(mergeDatabasePackages(original, [incoming]), /Incompatible schema/);
  assert.deepEqual(original, before);
});

test('SW04-STEP3F: duplicate IDs in incoming table rejected', async () => {
  const incoming = fixture('SOURCE-B', 'Field B', 7.2);
  incoming.tables.fields.rows.push({ id: 1, name: 'Duplicate incoming field' });
  await assert.rejects(mergeDatabasePackages(fixture('SOURCE-A', 'Field A', 6.5), [incoming]), /Duplicate fields ID/);
});
