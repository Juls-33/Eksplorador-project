import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRelativeMission, validateSequence, waypointToken, requireFreshGps, gpsObservation, compareWaypointGps, estimateRelativeMission, missionPrerequisites } from '../src/utils/missionPlanning.js';

const base = [14.609,120.989];
export const point = (north, east) => [base[0] + north / 111195, base[1] + east / (111195 * Math.cos(base[0] * Math.PI / 180))];
export const makePlan = (waypoints = [point(1,0),point(1,1)], overrides = {}) => createRelativeMission({
  waypoints, gps:{valid:true, position:base, receivedAt:1000, ageAtReceiptMs:100}, heading:0,
  headingConfirmed:true, calibrationConfirmed:true, now:1100, ...overrides,
});

for (const [name, route] of [
  ['Two-pin mission',[point(1,0),point(1,1)]],
  ['Three-pin mission',[point(2,0),point(2,2),point(0,2)]],
  ['Four-pin mission with turns',[point(2,0),point(2,2),point(0,2),point(0,0)]],
]) test(name, () => {
  const plan = makePlan(route);
  assert.equal(plan.tokens.filter(t => t[0] === 'W').length, route.length);
  assert.deepEqual(plan.legs.map(l => l.coordinates), route);
  assert.ok(plan.sequence.length <= 226 && plan.tokens.length <= 40);
  assert.ok(plan.tokens.some(t => /^[LR]/.test(t)));
  for (const token of plan.tokens.filter(t => t[0] !== 'W')) {
    assert.ok(Number(token.slice(1)) > 0);
    assert.ok(Number(token.slice(1)) <= (token[0] === 'F' ? 1.5 : 90));
  }
  assert.deepEqual(validateSequence(plan.sequence), plan.tokens);
});

test('W uses offset integer encoding and covers world boundaries and fractional rounding', () => {
  assert.equal(waypointToken(base), 'W104609000.300989000');
  assert.equal(waypointToken([-90,-180]), 'W00.0');
  assert.equal(waypointToken([90,180]), 'W180000000.360000000');
  assert.equal(waypointToken([14.6090006,120.9890006]), 'W104609001.300989001');
});

test('opposite heading splits 180 degrees; short movement and small turns are retained', () => {
  const plan = makePlan([point(0.2,0)], {heading:180});
  assert.deepEqual(plan.tokens.slice(0,3), ['L90','L90','F0.2']);
  const smallTurn = makePlan([point(1,0.02)]);
  assert.match(smallTurn.tokens[0], /^R1\./);
  assert.equal(makePlan([base,base]).tokens.filter(t => t[0] === 'W').length, 2);
});

test('plan snapshot is independent of mutable pins and incoming telemetry', () => {
  const route = [point(1,0)], gps = {valid:true, position:[...base], receivedAt:1000, ageAtReceiptMs:0};
  const plan = makePlan(route, {gps});
  route[0][0] = 0; gps.position[0] = 0;
  assert.notEqual(plan.legs[0].coordinates[0], 0);
  assert.equal(plan.origin[0], base[0]);
});

test('GPS must be explicitly valid, fresh and in range; receipt alone does not revive a stale fix', () => {
  const gps = gpsObservation({type:'fusion',positionSource:'GPS_ONLY',lat:base[0],lng:base[1],gpsValid:1,gpsAgeMs:4800,fusionSeq:1}, 1000);
  assert.deepEqual(requireFreshGps(gps,1200), base);
  for (const bad of [null, {...gps,valid:false}, {...gps,ageAtReceiptMs:undefined}, {...gps,ageAtReceiptMs:-1},
    {...gps,receivedAt:1300}, {...gps,ageAtReceiptMs:0.5}, {...gps,position:[91,120]}, {...gps,position:['14',120]}]) {
    assert.throws(() => requireFreshGps(bad,1200), /GPS/);
  }
  assert.throws(() => requireFreshGps(gps,1201), /GPS/);
  assert.throws(() => requireFreshGps(gpsObservation({lat:14,lng:120},1000),1100), /GPS/);
});

test('49.5 m plus 32.8 m is fully counted before rejection, even without heading confirmation or calibration', () => {
  const route = [point(49.5,0), point(49.5,32.8)];
  const estimate = estimateRelativeMission({waypoints:route,origin:base,heading:0});
  assert.equal(estimate.forwardSegments,55);
  assert.equal(estimate.waypointCount,2);
  assert.ok(estimate.tokenCount >= 57 && estimate.byteCount > 226);
  assert.equal(estimate.sequence,null); assert.equal(estimate.tokens,null);
  assert.equal(estimate.legs.length,2);
  assert.throws(() => makePlan(route), /40 tokens.*226 ASCII bytes.*55 forward segments/);
  const lower = estimateRelativeMission({waypoints:route,origin:base});
  assert.equal(lower.exact,false); assert.equal(lower.forwardSegments,55); assert.equal(lower.sequence,null);
});

test('prerequisites are evaluated independently; calibration/heading checks do not hide route capacity', () => {
  const gps={valid:true,source:'fusion',sequence:1,position:base,receivedAt:1000,ageAtReceiptMs:0};
  const route=estimateRelativeMission({waypoints:[point(1,0)],origin:base,heading:0});
  const args={gps,heading:0,headingConfirmed:true,calibrationConfirmed:true,firmwareConfirmed:true,
    radio:{connected:true,protocol_v2:true,mode:'RX'},route,now:1000};
  assert.ok(missionPrerequisites(args).every(item=>item.ready));
  const missing=missionPrerequisites({...args,gps:null,headingConfirmed:false,calibrationConfirmed:false,firmwareConfirmed:false,radio:{mode:'TX'}});
  assert.deepEqual(missing.map(item=>[item.key,item.ready]),[['gps',false],['heading',false],['calibration',false],['route',true],['radio',false],['firmware',false]]);
  assert.equal(missionPrerequisites({...args,radio:{...args.radio,mode:'TX'}}).find(p=>p.key==='radio').ready,false);
});

test('invalid, oversized and uncalibrated missions are rejected whole', () => {
  for (const changes of [{waypoints:[]},{waypoints:[[NaN,1]]},{waypoints:[[91,1]]},{heading:null},
    {heading:-1},{heading:360},{headingConfirmed:false},{calibrationConfirmed:false},{gps:null}]) {
    assert.throws(() => makePlan(undefined,changes));
  }
  assert.throws(() => makePlan([point(100,0)]), /40 tokens/);
  assert.throws(() => makePlan(Array.from({length:12}, () => base)), /226 ASCII/);
  for (const sequence of ['F2,W0.0','L91,W0.0','R0,W0.0','F-1,W0.0','F1e0,W0.0','FNaN,W0.0',
    'F1','W14.609.120.989','W180000001.0','W0.360000001','W9999999999.0',',W0.0','W0.0,','F.5,W0.0','Ｆ1,W0.0','F1.0001,W0.0']) {
    assert.throws(() => validateSequence(sequence), undefined, sequence);
  }
  assert.equal(validateSequence(`${'F1,'.repeat(39)}W00.0`).length,40);
  assert.throws(() => validateSequence(`${'F1,'.repeat(40)}W0.0`), /40 tokens/);
  const full = `${`F${'0'.repeat(21)}1,`.repeat(9)}W1000.1000`;
  assert.equal(full.length,226);
  validateSequence(full);
  assert.throws(() => validateSequence(`F0${full.slice(1)}`), /226 ASCII/);
  assert.throws(() => validateSequence(`F${'0'.repeat(22)}1,W00.0`),/23 ASCII/);
  assert.throws(() => validateSequence('W0.0'));
});

test('GPS comparison identifies missed and unavailable checkpoints without inventing arrival', () => {
  const gps = {valid:true, position:base, receivedAt:1000, ageAtReceiptMs:0};
  assert.equal(compareWaypointGps(base,gps,1000,3).result,'WITHIN_COMPARISON_RADIUS');
  assert.equal(compareWaypointGps(point(10,0),gps,1000,3).result,'OUTSIDE_COMPARISON_RADIUS');
  assert.equal(compareWaypointGps(base,{...gps,valid:false},1000,3).result,'GPS_UNVERIFIED');
});
