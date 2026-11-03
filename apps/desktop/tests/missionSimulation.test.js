import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWaypointPlan, MissionSimulation } from '../src/utils/missionSimulation.js';

const point = [14.6094, 120.9896];
const values = {ph:7, moisture:30, ec:100, nitrogen:1, phosphorus:2, potassium:3};
function environment(points = [point]) {
  const model = new MissionSimulation(createWaypointPlan('SIM-1', points));
  let now = 0;
  const input = () => ({operatorApproved:true, calibrationValidated:true, obstacleClear:true,
    gps:{valid:true, observedAt:now, position:model.plan.waypoints[model.index].coordinates, confidence:0.99, uncertaintyM:0.5},
    deadReckoning:{valid:true, calibrated:true, source:'ENCODER_IMU', observedAt:now, anchorAt:0, distanceSinceAnchorM:1,
      position:model.plan.waypoints[model.index].coordinates, confidence:0.99, uncertaintyM:0.7},
    drive:{valid:true, observedAt:now, stopped:true}, encoder:{valid:true, observedAt:now},
    imu:{valid:true, observedAt:now, tiltDegrees:0}, contact:{valid:true, observedAt:now},
    clearance:{valid:true, observedAt:now, mechanism:'VALIDATED_RETRACTION_SENSOR'},
    sample:{valid:true, observedAt:now, requestId:model.plan.waypoints[model.index].samplingRequestId, values:{...values}}});
  const step = (action = 'tick', modify = () => {}, elapsed = 100) => {
    now += elapsed;
    const observations = input(); modify(observations, now);
    const snapshot = model.step(now, observations, action);
    assert.deepEqual(snapshot.physicalOutputs, {drive:false, extend:false, retract:false});
    return snapshot;
  };
  const reach = phase => {
    for (let i = 0; i < 15 && model.phase !== phase; i++) step(model.phase === 'MISSION_STAGED' ? 'authorize' : 'tick');
    assert.equal(model.phase, phase);
  };
  return {model, step, reach};
}

test('plans freeze actual coordinates and stable unique waypoint/sample IDs with configurable requirements', () => {
  const points = [point.slice(), [14.61,120.99]];
  const plan = createWaypointPlan('route-1', points, {arrivalToleranceM:2, requiredConfidence:0.99, maxUncertaintyM:0.5});
  points[0][0] = 0;
  assert.deepEqual(plan.waypoints[0].coordinates, point);
  assert.equal(plan.waypoints[0].requiredConfidence, 0.99);
  assert.equal(plan.waypoints[0].arrivalToleranceM, 2);
  assert.equal(new Set(plan.waypoints.map(w => w.samplingRequestId)).size, 2);
  assert.throws(() => { plan.waypoints[0].coordinates[0] = 0; }, TypeError);
  for (const coords of [[], [[91,0]], [[0,Infinity]], [['14',120]]]) assert.throws(() => createWaypointPlan('x', coords));
  for (const options of [{arrivalToleranceM:0}, {requiredConfidence:1.1}, {maxUncertaintyM:-1}]) {
    assert.throws(() => createWaypointPlan('x', [point], options));
  }
  assert.throws(() => new MissionSimulation(plan, {maxSensorAgeMs:NaN}));
  assert.throws(() => new MissionSimulation({...plan, waypoints:[plan.waypoints[0], plan.waypoints[0]]}));
});

test('receipt never starts navigation; calibration and deliberate authorization are mandatory', () => {
  const {model, step} = environment();
  assert.equal(step().phase, 'MISSION_STAGED');
  assert.equal(step('authorize', i => {i.calibrationValidated = false;}).phase, 'MISSION_STAGED');
  assert.equal(step('authorize', i => {i.operatorApproved = false;}).phase, 'MISSION_STAGED');
  assert.equal(step('authorize').phase, 'NAVIGATING');
  assert.equal(model.samples.length, 0);
});

test('two waypoint sampling follows all phases and requires clearance before completion and the next waypoint', () => {
  const {model, step} = environment([point, [14.61,120.99]]);
  const phases = ['NAVIGATING','ARRIVAL_CONFIRMED','DRIVE_STOPPED','PROBE_EXTENDING','SOIL_SAMPLING',
    'PROBE_RETRACTING','RETRACTION_CONFIRMED','NEXT_WAYPOINT'];
  for (let waypoint = 0; waypoint < 2; waypoint++) {
    for (const phase of phases) assert.equal(step(phase === 'NAVIGATING' ? 'authorize' : 'tick').phase, phase);
    assert.equal(step().phase, waypoint === 0 ? 'MISSION_STAGED' : 'MISSION_COMPLETE');
  }
  assert.equal(model.samples.length, 2);
  assert.equal(new Set(model.samples.map(s => s.requestId)).size, 2);
  assert.ok(model.waypoints.every(w => w.arrival === 'CONFIRMED' && w.sampling === 'VALID' && w.completion === 'COMPLETE'));
  assert.equal(step('authorize').phase, 'MISSION_COMPLETE');
});

test('GPS dropout continues with fresh calibrated bounded encoder/IMU DR; it is not a critical fault', () => {
  const {step} = environment(); step('authorize');
  const s = step('tick', i => {i.gps.valid = false; i.deadReckoning.position = [14.6095,120.9896];});
  assert.equal(s.phase, 'NAVIGATING');
  assert.equal(s.localizationSource, 'BOUNDED_DR');
});

for (const [label, invalidate] of [
  ['uncalibrated observer', i => {i.deadReckoning.calibrated = false;}],
  ['A2.7 diagnostic FUS', i => {i.deadReckoning.source = 'A27_FUS';}],
  ['stale DR', (i,n) => {i.deadReckoning.observedAt = n - 301;}],
  ['unbounded uncertainty', i => {i.deadReckoning.uncertaintyM = 100;}],
  ['negative uncertainty', i => {i.deadReckoning.uncertaintyM = -1;}],
  ['invalid coordinate', i => {i.deadReckoning.position = [NaN,0];}],
  ['low confidence', i => {i.deadReckoning.confidence = 0.5;}],
  ['excess distance', i => {i.deadReckoning.distanceSinceAnchorM = 6;}],
  ['old anchor', (i,n) => {i.deadReckoning.anchorAt = n - 5001;}],
  ['stale encoder', (i,n) => {i.encoder.observedAt = n - 301;}],
  ['invalid encoder', i => {i.encoder.valid = false;}],
  ['stale IMU', (i,n) => {i.imu.observedAt = n - 301;}],
  ['invalid IMU', i => {i.imu.valid = false;}],
]) test(`GPS loss plus ${label} enters recoverable localization hold`, () => {
  const {step} = environment(); step('authorize');
  const s = step('tick', (i,n) => {i.gps.valid = false; invalidate(i,n);});
  assert.equal(s.phase, 'HOLD_LOCALIZATION');
  assert.equal(step().phase, 'HOLD_LOCALIZATION', 'valid data alone must not resume movement');
  assert.equal(step('recover', i => {i.operatorApproved = false;}).phase, 'HOLD_LOCALIZATION');
  assert.equal(step('recover').phase, 'MISSION_STAGED');
  assert.equal(step().phase, 'MISSION_STAGED');
  assert.equal(step('authorize').phase, 'NAVIGATING');
});

test('arrival requires real distance, confidence and uncertainty within tolerance', () => {
  const {step} = environment(); step('authorize');
  assert.equal(step('tick', i => {i.gps.position = [14.61,120.99];}).phase, 'NAVIGATING');
  assert.equal(step('tick', i => {i.gps.position = [14.609423,120.9896]; i.gps.uncertaintyM = 1;}).phase, 'NAVIGATING');
  assert.equal(step().phase, 'ARRIVAL_CONFIRMED');
  assert.equal(step('tick', i => {i.drive.stopped = false;}).phase, 'ARRIVAL_CONFIRMED');
  assert.equal(step().phase, 'DRIVE_STOPPED');
  assert.equal(step('tick', i => {i.gps.position = [14.61,120.99];}).phase, 'HOLD_SAFETY');
});

for (const phase of ['DRIVE_STOPPED','PROBE_EXTENDING','SOIL_SAMPLING','PROBE_RETRACTING']) {
  for (const kind of ['tilt','stale IMU','drive moving']) test(`${kind} inhibits ${phase} and latches a safety hold`, () => {
    const {step, reach} = environment(); reach(phase);
    assert.equal(step('tick', (i,n) => {
      if (kind === 'tilt') i.imu.tiltDegrees = 11;
      if (kind === 'stale IMU') i.imu.observedAt = n - 301;
      if (kind === 'drive moving') i.drive.stopped = false;
    }).phase, 'HOLD_SAFETY');
    assert.equal(step().phase, 'HOLD_SAFETY');
    assert.equal(step('recover', i => {i.clearance.valid = false;}).phase, 'HOLD_SAFETY');
  });
}

test('invalid, mismatched or pre-request soil readings do not complete sampling; sampling times out', () => {
  const {model, step, reach} = environment(); reach('SOIL_SAMPLING');
  for (const invalidate of [i => {i.sample.requestId = 'other';}, i => {i.sample.valid = false;},
    i => {i.sample.values.ph = 15;}, i => {i.sample.values.moisture = NaN;},
    i => {delete i.sample.values.ec;}, i => {i.sample.observedAt = 0;}]) {
    assert.equal(step('tick', invalidate).phase, 'SOIL_SAMPLING');
  }
  assert.equal(model.samples.length, 0);
  const s = step('tick', i => {i.sample.valid = false;}, 8000);
  assert.equal(s.phase, 'HOLD_SAFETY'); assert.equal(s.reason, 'SOIL_SAMPLE_TIMEOUT');
});

test('unconfirmed probe retraction times out; elapsed time or safe IMU cannot prove clearance', () => {
  const {model, step, reach} = environment(); reach('PROBE_RETRACTING');
  for (const invalidate of [i => {i.clearance.valid = false;}, i => {i.clearance.mechanism = 'IMU';},
    i => {i.clearance.observedAt = 0;}, i => {i.clearance.mechanism = 'SUPERVISED_CLEARANCE';}]) {
    assert.equal(step('tick', invalidate).phase, 'PROBE_RETRACTING');
  }
  const s = step('tick', i => {i.clearance.valid = false;}, 4000);
  assert.equal(s.phase, 'HOLD_SAFETY'); assert.equal(s.reason, 'RETRACTION_UNCONFIRMED');
  assert.equal(step().phase, 'HOLD_SAFETY');
  assert.equal(step('recover', i => {i.clearance.mechanism = 'SUPERVISED_CLEARANCE'; i.clearance.operatorApproved = true;}).phase, 'RETRACTION_CONFIRMED');
  assert.equal(model.samples.length, 1, 'recovery must not duplicate the completed request');
});

test('extension timeout, obstacle and missing clearance prevent progress', () => {
  const env = environment(); env.reach('PROBE_EXTENDING');
  assert.equal(env.step('tick', i => {i.contact.valid = false;}, 3000).reason, 'EXTENSION_TIMEOUT');
  for (const invalidate of [i => {i.obstacleClear = false;}, i => {i.encoder.valid = false;}, i => {i.clearance.valid = false;}]) {
    const {step} = environment(); step('authorize');
    assert.equal(step('tick', invalidate).phase, 'HOLD_SAFETY');
  }
});

test('pause recovery is explicit; abort and manual override are terminal and never auto-retract', () => {
  for (const phase of ['MISSION_STAGED','NAVIGATING','PROBE_EXTENDING','SOIL_SAMPLING','PROBE_RETRACTING']) {
    for (const [action, expected] of [['pause','PAUSED'], ['abort','ABORTED'], ['manualOverride','MANUAL_OVERRIDE']]) {
      const {step, reach} = environment(); reach(phase);
      assert.equal(step(action).phase, expected);
      assert.equal(step().phase, expected);
      if (action !== 'pause') assert.equal(step('recover').phase, expected);
      else {
        assert.equal(step('recover').phase, phase === 'PROBE_RETRACTING' ? 'RETRACTION_CONFIRMED' : 'MISSION_STAGED');
        assert.equal(step().phase === 'NAVIGATING', false);
      }
    }
  }
});

test('future timestamps, stale GPS and backwards simulation time never supply localization', () => {
  const {model, step} = environment(); step('authorize');
  assert.equal(step('tick', (i,n) => {i.gps.observedAt = n + 1; i.deadReckoning.valid = false;}).phase, 'HOLD_LOCALIZATION');
  assert.throws(() => model.step(-1, {}));
  assert.throws(() => model.step(1, {}));
  assert.equal(step('recover', (i,n) => {i.gps.observedAt = n - 1001; i.deadReckoning.valid = false;}).phase, 'HOLD_LOCALIZATION');
});
