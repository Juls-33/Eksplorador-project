/**
 * MTP-SW-01 — Crop pH Screening Regression
 * Read-only unit tests. Imports the real source function and uses in-memory fixtures.
 * Run from the Eksplorador-project root:
 *   node --test .\apps\desktop\tests\cropCompatibility.regression.test.mjs
 *
 * Reference limits below reproduce the test vectors in the MTP screenshot;
 * they are NOT assertions about the currently saved crop_profiles in SQLite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCropCompatibility,
  summarizeCropCompatibility,
} from '../src/utils/cropCompatibility.js';

const profiles = [
  { crop: 'Coffee (MTP fixture)', minPh: 5.5, maxPh: 6.5 },
  { crop: 'Cacao (MTP fixture)', minPh: 5.5, maxPh: 6.7 },
  { crop: 'Rice (MTP fixture)', minPh: 5.5, maxPh: 7.0 },
];
const screen = (ph, minPh=5.5, maxPh=6.5, soilType='', preferred=[]) =>
  evaluateCropCompatibility({ ph }, { minPh, maxPh }, soilType, preferred);

test('SW01-STEP1: in-range values match each MTP fixture', () => {
  for (const { crop, minPh, maxPh } of profiles) {
    const ph=(minPh+maxPh)/2;
    const actual=screen(ph,minPh,maxPh);
    assert.equal(actual.status,'matched',`${crop}: pH ${ph}`);
    assert.equal(actual.criteria.ph.status,'match');
    assert.equal(actual.criteria.ph.deviation,0);
    assert.equal(actual.checked,1);
  }
});

test('SW01-STEP2: exact lower and upper pH bounds are inclusive', () => {
  for (const {crop,minPh,maxPh} of profiles) {
    for (const ph of [minPh,maxPh]) {
      const actual=screen(ph,minPh,maxPh);
      assert.equal(actual.status,'matched',`${crop}: inclusive boundary ${ph}`);
      assert.equal(actual.criteria.ph.status,'match');
    }
  }
});

test('SW01-STEP2: 0.1 below/above thresholds requires review with correct deviation', () => {
  for (const {crop,minPh,maxPh} of profiles) {
    const low=screen(Number((minPh-0.1).toFixed(1)),minPh,maxPh);
    const high=screen(Number((maxPh+0.1).toFixed(1)),minPh,maxPh);
    assert.equal(low.status,'review',`${crop}: below`);
    assert.equal(low.criteria.ph.status,'below');
    assert.equal(low.criteria.ph.deviation,0.1);
    assert.deepEqual(low.failed,['ph']);
    assert.equal(high.status,'review',`${crop}: above`);
    assert.equal(high.criteria.ph.status,'above');
    assert.equal(high.criteria.ph.deviation,0.1);
    assert.deepEqual(high.failed,['ph']);
  }
});

test('SW01-STEP3: null, missing, empty, nonnumeric, and out-of-domain pH are insufficient', () => {
  const invalid=[null,undefined,'','not-a-number',NaN,Infinity,-0.1,14.1];
  for (const ph of invalid) {
    const r=screen(ph);
    assert.equal(r.status,'insufficient',`pH input ${String(ph)}`);
    assert.equal(r.criteria.ph.status,'unavailable');
    assert.equal(r.checked,0);
  }
});

test('SW01-STEP3: whitespace-only pH is invalid (regression edge case)', () => {
  const r=screen('   ');
  assert.equal(r.status,'insufficient','Whitespace-only input must not be treated as pH 0');
  assert.equal(r.criteria.ph.status,'unavailable');
});

test('SW01-STEP3: missing, reversed, or identical threshold bounds give insufficient', () => {
  const invalidBounds=[{}, {minPh:5.5}, {maxPh:6.5}, {minPh:7,maxPh:5}, {minPh:6,maxPh:6}];
  for (const bounds of invalidBounds) {
    const r=evaluateCropCompatibility({ph:6},bounds);
    assert.equal(r.status,'insufficient',JSON.stringify(bounds));
  }
});

test('SW01-STEP3: zero valid pH records are all insufficient, not matched', () => {
  const {counts}=summarizeCropCompatibility([{ph:null},{ph:''},{ph:undefined}],{minPh:5.5,maxPh:6.5},'');
  assert.deepEqual([counts.total,counts.matched,counts.review,counts.insufficient],[3,0,0,3]);
  assert.equal(counts.phMatched,0);
});

test('SW01-STEP4: mixed-dataset status counts use all rows and preserve valid-pH counts', () => {
  const samples=[{ph:6.0},{ph:5.4},{ph:6.6},{ph:null},{ph:'oops'}];
  const {evaluated,counts}=summarizeCropCompatibility(samples,{minPh:5.5,maxPh:6.5},'');
  assert.equal(evaluated.length,5);
  assert.deepEqual([counts.total,counts.matched,counts.review,counts.insufficient],[5,1,2,2]);
  assert.equal(counts.phMatched,1);
  assert.equal(counts.soilNotEvaluated,5);
  assert.equal(counts.matched+counts.review+counts.insufficient,counts.total);
  assert.equal(100*(counts.matched+counts.review)/counts.total,60); // derived valid-pH share, NOT UI output
});

test('SW01-STEP4: no samples return zero counts without divide-by-zero', () => {
  const {evaluated,counts}=summarizeCropCompatibility([],{minPh:5.5,maxPh:6.5},'');
  assert.equal(evaluated.length,0);
  assert.deepEqual([counts.total,counts.matched,counts.review,counts.insufficient,counts.phMatched],[0,0,0,0,0]);
});

test('SW01-STEP4: compatible soil type does not change an in-range pH match', () => {
  const r=screen(6,5.5,6.5,'Loam',['Loam','Clay loam']);
  assert.equal(r.status,'matched');
  assert.equal(r.checked,2);
  assert.equal(r.criteria.soilType.status,'match');
});

test('SW01-STEP4: incompatible soil type marks an otherwise matching pH for review', () => {
  const r=screen(6,5.5,6.5,'Silt loam',['Loam','Clay loam']);
  assert.equal(r.criteria.ph.status,'match');
  assert.equal(r.criteria.soilType.status,'review');
  assert.equal(r.status,'review');
  assert.deepEqual(r.failed,['soil_type']);
});

test('SW01-STEP4: invalid pH remains insufficient even with valid soil-texture tag', () => {
  const r=screen(null,5.5,6.5,'Loam',['Loam']);
  assert.equal(r.criteria.soilType.status,'match');
  assert.equal(r.status,'insufficient');
});
