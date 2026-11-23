import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_PLANNING_RADIUS_M, isWithinPlanningRadius, planningDistanceM } from '../src/utils/planningRadius.js';
import { FORWARD_MPS, MAX_LEG_S, freshFusionStart, makeStraightLeg, operatorMapStart } from '../src/utils/pointToPointMission.js';

const pin = [14.60732, 120.988695];
const northM = meters => [pin[0] + meters / 111195, pin[1]];

// Deliberately compares UI guidance to the unchanged final mission validator.
test('planning circle uses the exact existing maximum timed leg', () => {
  assert.equal(MAX_PLANNING_RADIUS_M, FORWARD_MPS * MAX_LEG_S);
  assert.ok(MAX_PLANNING_RADIUS_M > 39 && MAX_PLANNING_RADIUS_M < 40);
});
test('valid nearby Point A stays selectable and produces the original TF command', () => {
  const pointA = northM(20);
  assert.equal(isWithinPlanningRadius(pointA, pin), true);
  const plan = makeStraightLeg({ start: operatorMapStart(pointA), target: pin, pinIndex: 0 });
  assert.equal(plan.protocol, 'A31_TIMED');
  assert.ok(plan.sequence.startsWith('TF'));
  assert.ok(plan.durationS <= MAX_LEG_S);
});
test('out-of-range map pick is rejected by the UI and the original validator', () => {
  const pointA = northM(45);
  assert.equal(isWithinPlanningRadius(pointA, pin), false);
  assert.throws(() => makeStraightLeg({ start: operatorMapStart(pointA), target: pin, pinIndex: 0 }), /closer destination/);
});
test('selection matches the authoritative validator on both sides of the boundary', () => {
  for (const distance of [0.5, 5, 19, 39.3, 39.52, 39.57, 40, 44, 100]) {
    const pointA = northM(distance);
    const within = isWithinPlanningRadius(pointA, pin);
    let valid = true;
    try { makeStraightLeg({ start: operatorMapStart(pointA), target: pin, pinIndex: 1 }); }
    catch { valid = false; }
    assert.equal(within, valid, `${distance} m must agree with the TF validator`);
  }
});
test('fresh GPS is guided by the same circle, without forging a GPS fix', () => {
  const now = 1700000000000;
  const validGps = { source: 'fusion', valid: true, position: northM(25), receivedAt: now, ageAtReceiptMs: 100 };
  const farGps = { ...validGps, position: northM(60) };
  const start = freshFusionStart(validGps, now + 500);
  assert.ok(start && isWithinPlanningRadius(start.coords, pin));
  assert.equal(isWithinPlanningRadius(freshFusionStart(farGps, now + 500)?.coords, pin), false);
  assert.equal(freshFusionStart(validGps, now + 6000), null, 'stale GPS remains rejected');
});
test('invalid points never count as in range', () => {
  assert.equal(isWithinPlanningRadius(null, pin), false);
  assert.equal(isWithinPlanningRadius([0, 0], pin), false);
  assert.equal(isWithinPlanningRadius([NaN, 120], pin), false);
  assert.equal(isWithinPlanningRadius(pin, null), false);
  assert.equal(planningDistanceM(null, pin), null);
});
test('map circle is opt-in and noninteractive so normal field map clicks stay intact', () => {
  const here = fileURLToPath(new URL('../src/components/HeatmapMap.jsx', import.meta.url));
  const source = readFileSync(here, 'utf8');
  assert.match(source, /interactionMode !== 'SELECT_ROVER_START'/);
  assert.match(source, /L\.circle\(planningTargetPos/);
  assert.match(source, /interactive: false/);
  assert.match(source, /planningPickRadiusM = null/);
});
