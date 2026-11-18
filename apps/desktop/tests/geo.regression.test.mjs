/**
 * Eksplorador desktop — no-dependency GIS regression tests.
 * Uses the REAL project module at ../src/utils/geo.js.
 * node --test apps/desktop/tests/geo.regression.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateHeatPoints,
  generateIDWHeatmapGrid,
  isPointInPolygon,
} from '../src/utils/geo.js';

// Four independent GIS-02 sample coordinates, not rover telemetry.
const north = 14.6084000772405;
const south = 14.6082204150055;
const west = 120.989359231363;
const east = 120.989544895641;
const middleLat = (north + south) / 2;
const middleLng = (west + east) / 2;
const sample = (left = 20, right = 40) => [
  [north, west, left],
  [north, east, right],
  [south, west, left],
  [south, east, right],
];
// Small expanded rectangle: all four known points are INSIDE its boundary.
const pad = 0.000004;
const boundary = [
  [south - pad, west - pad],
  [south - pad, east + pad],
  [north + pad, east + pad],
  [north + pad, west - pad],
];
const opts = {
  gridResolution: 96,
  power: 2,
  maxInfluenceRadiusM: 25,
  minNeighbors: 2,
};
const grid = (p, config = {}) => generateIDWHeatmapGrid(p, boundary, {...opts, ...config});
function nearest(rows, lat, lng) {
  if (!rows.length) return null;
  let best = null;
  for (const [a,b,v] of rows) {
    const meters = Math.hypot(
      (a - lat) * 111320,
      (b - lng) * 111320 * Math.cos(lat * Math.PI / 180),
    );
    if (best === null || meters < best.meters) best = { value:v, meters, lat:a, lng:b };
  }
  return best;
}
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`);

test('GIS-AUTO-01: all four original sample measurements are preserved', () => {
  const rows = grid(sample());
  assert.ok(rows.length >= 4);
  for (const [lat, lng, value] of sample()) {
    const exact = rows.find(r => r[0] === lat && r[1] === lng && r[2] === value);
    assert.ok(exact, `Missing preserved sample (${lat}, ${lng})=${value}`);
  }
});

test('GIS-AUTO-02: baseline center is 30% within grid tolerance', () => {
  const p = nearest(grid(sample()), middleLat, middleLng);
  assert.ok(p && p.meters <= 0.35, 'Grid did not include a near-center prediction');
  close(p.value, 30, 0.2, 'Baseline center IDW');
});

test('GIS-AUTO-03: moisture interpolates upwards west to east and stays within observed bounds', () => {
  const rows = grid(sample());
  const w = nearest(rows, middleLat, west + (east - west) / 4);
  const c = nearest(rows, middleLat, middleLng);
  const e = nearest(rows, middleLat, west + 3 * (east - west) / 4);
  assert.ok(w && c && e);
  assert.ok(w.value < c.value && c.value < e.value,
    `Expected west < center < east; got ${w.value}, ${c.value}, ${e.value}`);
  close(w.value, 25.5556, 0.35, 'Western quarter');
  close(e.value, 34.4444, 0.35, 'Eastern quarter');
  for (const [, , v] of rows) {
    assert.ok(v >= 20 - 1e-9 && v <= 40 + 1e-9,
      `IDW result outside contributing data range: ${v}`);
  }
});

test('GIS-AUTO-04: changing east-side readings to 60% shifts center to 40%', () => {
  const p = nearest(grid(sample(20, 60)), middleLat, middleLng);
  assert.ok(p && p.meters <= 0.35);
  close(p.value, 40, 0.2, 'Modified center IDW');
});

test('GIS-AUTO-05: duplicate coordinates are consolidated, not counted twice', () => {
  const a = sample();
  assert.equal(consolidateHeatPoints([...a, [...a[0]]]).length, 4);
  const baseline = nearest(grid(a), middleLat, middleLng);
  const withDuplicate = nearest(grid([...a, [...a[0]]]), middleLat, middleLng);
  close(withDuplicate.value, baseline.value, 1e-8, 'Duplicate-suppression center');
});

test('GIS-AUTO-06: interpolation does not invent center values beyond the permitted radius', () => {
  const rows = grid(sample(), { maxInfluenceRadiusM: 1, minNeighbors: 2 });
  const nearestCenter = nearest(rows, middleLat, middleLng);
  assert.ok(nearestCenter === null || nearestCenter.meters > 1,
    'Unexpected unsupported center prediction at 1m radius');
});

test('GIS-AUTO-07: field polygon distinguishes points inside and outside', () => {
  assert.equal(isPointInPolygon([middleLat, middleLng], boundary), true);
  assert.equal(isPointInPolygon([north + 0.001, east + 0.001], boundary), false);
});
