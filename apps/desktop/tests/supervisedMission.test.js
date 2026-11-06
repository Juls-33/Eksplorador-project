import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMissionHoldStore, estimatedPosition, gpsPosition, GPS_FRESH_MS, hasSafetyHold, initialSupervisedMission,
  planMovementLeg, sampleMeasuredCoordinates, supervisedMissionReducer as reduce,
  MOVEMENT_PROFILE, TIMED_MOVEMENT_AVAILABLE,
} from '../src/utils/supervisedMission.js';

const now = 100000;
const point = [14.6094, 120.9896];
const estimate = estimatedPosition(point, now);
const plan = overrides => planMovementLeg({ start: estimate, heading: 0, target: [14.60941, 120.9896], now, ...overrides });
const ready = () => reduce(initialSupervisedMission(), { type: 'CONFIRM_START', position: estimate, heading: 0, probeClear: true, now });
const inspect = () => reduce(ready(), { type: 'INSPECT', stopped: true, now });
const sampling = () => reduce(inspect(), { type: 'ACCEPT_ARRIVAL', stopped: true, position: estimate, now });

test('GPS requires satellite validity, valid coordinates and a fresh receipt', () => {
  const data = { lat: point[0], lng: point[1], satsLocked: 8 };
  assert.equal(gpsPosition(data, now, now).source, 'GPS_MEASURED');
  assert.ok(gpsPosition(data, now, now + GPS_FRESH_MS));
  for (const changed of [{ satsLocked: 0 }, { satsLocked: null }, { satsLocked: 1.5 }, { lat: null }, { lng: '' }, { lng: ' ' }, { lat: true }, { lat: [] }, { lat: 91 }, { lng: 181 }, { lat: 0, lng: 0 }]) {
    assert.equal(gpsPosition({ ...data, ...changed }, now, now), null);
  }
  assert.equal(gpsPosition(data, now, now + GPS_FRESH_MS + 1), null);
  assert.equal(gpsPosition(data, now + 1, now), null);
  assert.equal(gpsPosition(data, null, now), null);
});

test('manual map position is explicitly estimated and works without GPS', () => {
  assert.deepEqual(estimate, { coords: point, source: 'OPERATOR_ESTIMATED', confirmedAt: now });
  assert.equal(estimatedPosition([null, null]), null);
  assert.equal(ready().phase, 'READY');
  assert.equal(plan().error, undefined);
  assert.equal(plan({ start: { ...estimate, source: 'GPS_MEASURED', confirmedAt: 0 } }).instructions, undefined);
});

test('the centralized field-tested movement profile requires no operator-entered rates', () => {
  assert.deepEqual(MOVEMENT_PROFILE, { name: 'Field-tested A3.1', forwardMps: 0.25, leftDps: 112.5, rightDps: 112.5 });
  assert.equal(Object.isFrozen(MOVEMENT_PROFILE), true);
  assert.equal(plan().error, undefined);
});

test('unknown or unconfirmed heading and probe clearance never yield a ready mission', () => {
  for (const heading of ['', null, undefined, NaN, -1, 360, Infinity]) assert.ok(plan({ heading }).error);
  assert.equal(reduce(initialSupervisedMission(), { type: 'CONFIRM_START', position: estimate, heading: '', probeClear: true, now }).phase, 'PLANNING');
  assert.equal(reduce(initialSupervisedMission(), { type: 'CONFIRM_START', position: estimate, heading: 0, probeClear: false, now }).phase, 'PLANNING');
});

test('time conversion uses the field-tested forward speed and left/right turning rates', () => {
  const forward = plan({ target: [point[0] + 0.000001, point[1]] });
  assert.equal(forward.instructions.length, 1);
  assert.ok(forward.instructions[0].durationS <= forward.distanceM / 0.25);
  assert.ok(forward.distanceM / 0.25 - forward.instructions[0].durationS < 0.001);
  const east = [point[0], point[1] + 0.00001];
  const right = plan({ target: east });
  assert.equal(right.instructions[0].action, 'Pivot right');
  assert.equal(right.instructions[0].durationS, 0.8);
  const left = plan({ heading: 180, target: east });
  assert.equal(left.instructions[0].action, 'Pivot left');
  assert.equal(left.instructions[0].durationS, 0.8);
});

test('each leg stops at its duration limit without generating an entire route', () => {
  const forward = plan();
  assert.equal(forward.partial, true);
  assert.deepEqual(forward.instructions, [{ action: 'Forward', durationS: 2 }]);
  const turnOnly = plan({ heading: 180 });
  assert.equal(turnOnly.instructions.length, 1);
  assert.equal(turnOnly.instructions[0].durationS, 1.5);
  assert.equal(turnOnly.partial, true);
  for (let heading = 0; heading < 360; heading += 7) {
    const bounded = plan({ heading });
    if (bounded.error) {
      assert.match(bounded.error, /at least 0.100/);
      continue;
    }
    assert.ok(bounded.instructions.length <= 2);
    assert.ok(bounded.instructions.every(instruction => instruction.durationS > 0 && instruction.durationS <= 2));
    assert.ok(bounded.totalS <= 4);
  }
  assert.ok(plan({ target: [point, point] }).error);
  assert.equal(TIMED_MOVEMENT_AVAILABLE, true);
});

test('ACK2, packet delivery and elapsed timers cannot verify execution or arrival', () => {
  let state = ready();
  state = reduce(state, { type: 'RADIO_EVIDENCE', transmitted: true, acknowledged: true });
  assert.equal(state.phase, 'READY');
  assert.equal(state.execution, 'UNVERIFIED');
  assert.equal(state.movementAuthorized, false);
  for (const type of ['ACK2', 'TIMER_ELAPSED', 'EXECUTION_COMPLETED']) assert.equal(reduce(state, { type }), state);
  assert.equal(reduce(state, { type: 'INSPECT', stopped: false }), state);
  assert.deepEqual(state.completed, []);
});

test('arrival can be accepted outside five meters but only after inspection and location confirmation', () => {
  const farAway = estimatedPosition([14.6104, 120.9906], now + 1);
  assert.equal(reduce(ready(), { type: 'ACCEPT_ARRIVAL', stopped: true, position: farAway, now: now + 1 }).phase, 'READY');
  const accepted = reduce(inspect(), { type: 'ACCEPT_ARRIVAL', stopped: true, position: farAway, now: now + 1 });
  assert.equal(accepted.phase, 'SAMPLING');
  assert.deepEqual(accepted.arrival, farAway);
  assert.equal(reduce(inspect(), { type: 'ACCEPT_ARRIVAL', stopped: true, position: estimatedPosition(point, now - 1), now }).phase, 'INSPECTION');
  const rejected = reduce(inspect(), { type: 'REPLAN' });
  assert.equal(rejected.phase, 'PLANNING');
  assert.equal(rejected.start, null);
  assert.equal(rejected.heading, null);
});

test('manual RC takeover invalidates both starting position and heading', () => {
  const manual = reduce(ready(), { type: 'MANUAL_TAKEOVER', probeClear: true });
  assert.equal(manual.phase, 'MANUAL');
  assert.equal(manual.start, null);
  assert.equal(manual.heading, null);
  assert.equal(manual.execution, 'UNVERIFIED');
  assert.equal(reduce(manual, { type: 'CONFIRM_START', position: estimate, heading: 0, probeClear: true, now }), manual);
  const stopped = reduce(manual, { type: 'INSPECT', stopped: true, now });
  assert.equal(stopped.phase, 'INSPECTION');
  assert.equal(reduce(stopped, { type: 'REPLAN' }).phase, 'PLANNING');
});

test('manual sampling, successful save, finished confirmation and retraction precede next-leg authorization', () => {
  let state = sampling();
  assert.equal(state.phase, 'SAMPLING');
  assert.equal(reduce(state, { type: 'CONFIRM_RETRACTED', retracted: true, finished: true, pinCount: 2 }), state);
  state = reduce(state, { type: 'SAMPLE_SAVED' });
  assert.equal(state.phase, 'RETRACT');
  assert.equal(reduce(state, { type: 'CONFIRM_RETRACTED', retracted: false, finished: true, pinCount: 2 }), state);
  assert.equal(reduce(state, { type: 'CONFIRM_RETRACTED', retracted: true, finished: false, pinCount: 2 }), state);
  assert.equal(reduce(state, { type: 'CONFIRM_RETRACTED', retracted: true, finished: true }), state);
  state = reduce(state, { type: 'CONFIRM_RETRACTED', retracted: true, finished: true, pinCount: 2 });
  assert.equal(state.phase, 'NEXT_LEG');
  assert.deepEqual(state.completed, [0]);
  assert.equal(reduce(state, { type: 'AUTHORIZE_NEXT', authorized: false, index: 1 }), state);
  assert.equal(reduce(state, { type: 'AUTHORIZE_NEXT', authorized: true, index: 0, pinCount: 2 }), state);
  assert.equal(reduce(state, { type: 'AUTHORIZE_NEXT', authorized: true, index: 2, pinCount: 2 }), state);
  state = reduce(state, { type: 'AUTHORIZE_NEXT', authorized: true, index: 1, pinCount: 2 });
  assert.equal(state.phase, 'PLANNING');
  assert.equal(state.pinIndex, 1);
  assert.equal(state.start, null);
  assert.equal(state.heading, null);
});

test('last pin completion and cancellation are terminal and cannot be auto-resumed', () => {
  const complete = reduce(reduce(sampling(), { type: 'SAMPLE_SAVED' }), { type: 'CONFIRM_RETRACTED', retracted: true, finished: true, pinCount: 1 });
  assert.equal(complete.phase, 'COMPLETE');
  assert.equal(reduce(complete, { type: 'AUTHORIZE_NEXT', authorized: true, index: 0 }), complete);
  const cancelled = reduce(ready(), { type: 'CANCEL' });
  assert.equal(cancelled.phase, 'CANCELLED');
  assert.equal(reduce(cancelled, { type: 'INSPECT', stopped: true }), cancelled);
});

const reportFault = state => reduce(state, { type: 'REPORT_OPERATOR_FAULT', reason: 'Obstacle reported by operator', now });
const review = { type: 'REVIEW_OPERATOR_REPORT', resolution: 'ENTERED_IN_ERROR', disarmed: true, stationary: true, safe: true, probeClear: true };
const firmwareFault = state => reduce(state, { type: 'FIRMWARE_FAULT', verified: true, faultId: 'test-fault-1', reason: 'Physical safety interlock active' });

test('local operator reports expose their source and block ordinary progression', () => {
  const held = reportFault(sampling());
  for (const event of [{ type: 'REPLAN' }, { type: 'MANUAL_TAKEOVER', probeClear: true }, { type: 'SAMPLE_SAVED' }, { type: 'CONFIRM_RETRACTED', retracted: true, finished: true, pinCount: 1 }]) assert.equal(reduce(held, event), held);
  assert.equal(held.hold.source, 'OPERATOR_REPORT');
  assert.equal(held.hold.trigger, 'REPORT_OPERATOR_FAULT button');
  assert.equal(held.hold.reason, 'Obstacle reported by operator');
  assert.equal(held.operatorReport.confirmedPhysical, false);
  assert.equal(held.firmwareFault, null);
  const cleared = reduce(held, review);
  assert.equal(cleared.phase, 'PLANNING');
  assert.equal(cleared.start, null);
  assert.equal(cleared.heading, null);
  assert.equal(cleared.probeRetracted, false);
  assert.equal(cleared.movementAuthorized, false);
  assert.equal(hasSafetyHold(cleared), false);
});

test('false-report correction requires every physical safety confirmation and a review result', () => {
  const held = reportFault(ready());
  for (const key of ['disarmed', 'stationary', 'safe', 'probeClear']) {
    assert.equal(reduce(held, { ...review, [key]: false }), held);
    assert.equal(reduce(held, { ...review, [key]: undefined }), held);
  }
  assert.equal(reduce(held, { ...review, resolution: '' }), held);
  assert.equal(reduce(held, { type: 'FAULT_CLEARED' }), held);
});

test('a genuine operator-confirmed condition survives cancellation/new missions until physically resolved', () => {
  const held = reduce(reportFault(ready()), { type: 'CONFIRM_OPERATOR_HAZARD' });
  assert.equal(held.operatorReport.confirmedPhysical, true);
  assert.equal(reduce(held, review), held);
  assert.equal(reduce(held, { type: 'REPLAN' }), held);
  const cancelled = reduce(held, { type: 'CANCEL' });
  assert.equal(cancelled.phase, 'CANCELLED');
  const fresh = reduce(cancelled, { type: 'RESET', missionId: 'next' });
  assert.equal(fresh.phase, 'HELD');
  assert.equal(fresh.hold.source, 'OPERATOR_REPORT');
  assert.equal(reduce(fresh, { ...review, resolution: 'PHYSICALLY_RESOLVED' }).phase, 'PLANNING');
});

test('firmware-confirmed faults require a matching verified firmware clearance, never a UI action', () => {
  const held = firmwareFault(reportFault(ready()));
  assert.equal(held.hold.source, 'FIRMWARE_CONFIRMED');
  assert.equal(held.hold.faultId, 'test-fault-1');
  for (const event of [review, { ...review, resolution: 'PHYSICALLY_RESOLVED' }, { type: 'FAULT_CLEARED' }, { type: 'REPLAN' },
    { type: 'FIRMWARE_FAULT_CLEARED', faultId: 'test-fault-1' },
    { type: 'FIRMWARE_FAULT_CLEARED', verified: true, faultId: 'wrong-fault' }]) assert.equal(reduce(held, event), held);
  const fresh = reduce(reduce(held, { type: 'CANCEL' }), { type: 'RESET', missionId: 'next' });
  assert.equal(fresh.phase, 'HELD');
  assert.equal(fresh.firmwareFault.faultId, 'test-fault-1');
  const cleared = reduce(fresh, { type: 'FIRMWARE_FAULT_CLEARED', verified: true, faultId: 'test-fault-1' });
  assert.equal(cleared.firmwareFault, null);
  assert.equal(cleared.phase, 'HELD');
  assert.equal(cleared.hold.source, 'WORKFLOW');
  assert.equal(reduce(cleared, { type: 'REPLAN' }).phase, 'PLANNING');
  const stillReported = reduce(held, { type: 'FIRMWARE_FAULT_CLEARED', verified: true, faultId: 'test-fault-1' });
  assert.equal(stillReported.hold.source, 'OPERATOR_REPORT');
  assert.equal(reduce(stillReported, review).phase, 'PLANNING');
});

test('unverified or incomplete firmware-fault events do not invent a physical fault', () => {
  const state = initialSupervisedMission();
  for (const event of [{ type: 'FIRMWARE_FAULT', faultId: 'x', reason: 'test' }, { type: 'FIRMWARE_FAULT', verified: true, reason: 'test' }]) assert.equal(reduce(state, event), state);
  const cleared = reduce(firmwareFault(ready()), { type: 'FIRMWARE_FAULT_CLEARED', verified: true, faultId: 'test-fault-1' });
  assert.equal(cleared.phase, 'HELD');
  assert.equal(cleared.hold.source, 'WORKFLOW');
  assert.equal(reduce(cleared, { type: 'REPLAN' }).phase, 'PLANNING');
});

test('missing position, incomplete planning and rejected arrival do not create safety faults', () => {
  const state = initialSupervisedMission();
  assert.equal(reduce(state, { type: 'CONFIRM_START', position: null, heading: 0, probeClear: true }), state);
  assert.ok(plan({ start: null }).error);
  assert.equal(hasSafetyHold(state), false);
  const rejected = reduce(inspect(), { type: 'REPLAN' });
  assert.equal(rejected.phase, 'PLANNING');
  assert.equal(rejected.hold, null);
  assert.equal(hasSafetyHold(rejected), false);
});

test('cancellation clears an unverified mission-local report and a fresh mission starts in planning', () => {
  const state = reduce(reportFault(ready()), { type: 'CANCEL' });
  assert.equal(state.phase, 'CANCELLED');
  assert.equal(state.operatorReport, null);
  assert.equal(state.hold, null);
  assert.equal(reduce(state, review), state);
  const fresh = reduce(state, { type: 'RESET', missionId: 'fresh' });
  assert.equal(fresh.phase, 'PLANNING');
  assert.equal(fresh.hold, null);
});

test('session memory restores local reports only for their mission and does not resurrect corrected hazards', () => {
  const store = createMissionHoldStore();
  const first = reportFault(reduce(initialSupervisedMission(), { type: 'RESET', missionId: 'first' }));
  store.remember(first);
  const reopen = id => reduce(initialSupervisedMission(), { type: 'RESET', missionId: id, savedSafety: store.restore(id) });
  assert.equal(reopen('first').phase, 'HELD');
  assert.equal(reopen('unrelated').phase, 'PLANNING');
  store.remember(reduce(first, { type: 'CONFIRM_OPERATOR_HAZARD' }));
  const unrelated = reopen('unrelated');
  assert.equal(unrelated.phase, 'HELD');
  store.remember(reduce(unrelated, { ...review, resolution: 'PHYSICALLY_RESOLVED' }));
  assert.equal(reopen('first').phase, 'PLANNING');
  store.remember(firmwareFault(reopen('first')));
  assert.equal(reopen('new').hold.source, 'FIRMWARE_CONFIRMED');
});

test('switching missions drops a local unverified report, while cancellation closes it in session memory', () => {
  const store = createMissionHoldStore();
  const first = reportFault(reduce(initialSupervisedMission(), { type: 'RESET', missionId: 'first' }));
  store.remember(first);
  assert.equal(reduce(first, { type: 'RESET', missionId: 'second', savedSafety: store.restore('second') }).phase, 'PLANNING');
  store.remember(reduce(first, { type: 'CANCEL' }));
  assert.equal(store.restore('first').operatorReport, null);
});

test('receiver interruption never resumes automatically and invalidates navigation and probe clearance', () => {
  const held = reduce(ready(), { type: 'INTERRUPT' });
  assert.equal(held.phase, 'HELD');
  assert.equal(held.start, null);
  assert.equal(held.heading, null);
  assert.equal(held.probeRetracted, false);
  assert.equal(held.execution, 'UNVERIFIED');
  assert.equal(held.hold.source, 'WORKFLOW');
  assert.equal(hasSafetyHold(held), false);
  assert.equal(reduce(held, { type: 'RADIO_EVIDENCE', acknowledged: true }).phase, 'HELD');
  assert.equal(reduce(held, { type: 'REPLAN' }).phase, 'PLANNING');
});

test('sample coordinates are measured GPS or empty, never copied from the intended pin or map estimate', () => {
  assert.deepEqual(sampleMeasuredCoordinates({ soilValid: 1 }, now, now), { lat: null, lng: null, coords: null });
  assert.deepEqual(sampleMeasuredCoordinates({ lat: point[0], lng: point[1], satsLocked: 0 }, now, now), { lat: null, lng: null, coords: null });
  assert.deepEqual(sampleMeasuredCoordinates({ lat: point[0], lng: point[1], satsLocked: 8 }, now, now), { lat: point[0], lng: point[1], coords: point });
});
