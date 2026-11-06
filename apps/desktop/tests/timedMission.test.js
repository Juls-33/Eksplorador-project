import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeTimedLeg, validateTimedLeg } from '../src/utils/timedMission.js';
import { estimatedPosition, initialSupervisedMission, planMovementLeg, supervisedMissionReducer as reduce } from '../src/utils/supervisedMission.js';

test('timed serialization is exactly the Mega seconds grammar, without a prefix or units conversion', () => {
  assert.equal(serializeTimedLeg([{ action: 'Forward', durationS: 0.25 }]), 'TF0.250');
  assert.equal(serializeTimedLeg([{ action: 'Pivot left', durationS: 0.5 }]), 'TL0.500');
  assert.equal(serializeTimedLeg([{ action: 'Pivot right', durationS: 0.8 }, { action: 'Forward', durationS: 1.5 }]), 'TR0.800,TF1.500');
});

test('inclusive step/turn limits and two-step four-second limit validate without rounding', () => {
  for (const text of ['TF0.100', 'TF2.000', 'TL0.100', 'TR1.500', 'TL1.500,TF2.000', 'TF2.000,TF2.000']) assert.equal(validateTimedLeg(text).error, undefined, text);
  assert.equal(validateTimedLeg('TF2.000,TF2.000').totalS, 4);
  for (const text of ['TF0.099', 'TF2.001', 'TL1.501', 'TR2.000', 'TF2.0000000000000001', 'TR1.5000000000000001', 'TF0.09999999999999999', 'TF2.000,TF2.001']) assert.ok(validateTimedLeg(text).error, text);
});

test('timed pathway rejects legacy, reverse, actuator and all non-contract characters', () => {
  for (const text of ['', 'F5', 'L90', 'R90', 'B1', 'TB0.100', 'TA0.500', 'EXTEND', 'RETRACT', 'TIME:TF0.250',
    ' TF0.100', 'TF0.100 ', 'TF0.100\n', 'TF0.100\r\n', 'TF0.100, TL0.100', 'TF+0.100', 'TF-0.100',
    'TF.100', 'TF1.', 'TF1e0', 'TFNaN', 'TFInfinity', 'TF０.１００', ',TF0.100', 'TF0.100,', 'TF0.100,,TR0.100',
    'TF0.100,TR0.100,TF0.100']) assert.ok(validateTimedLeg(text).error, JSON.stringify(text));
});

test('226-byte sequence limit rejects the whole leg, never trims it', () => {
  const exact = `TF${'0'.repeat(219)}0.100`;
  assert.equal(new TextEncoder().encode(exact).length, 226);
  assert.equal(validateTimedLeg(exact).error, undefined);
  assert.match(validateTimedLeg(`T${exact}`).error, /226-byte/);
  const oversizedValidDecimal = `TF${'0'.repeat(220)}0.100`;
  assert.match(validateTimedLeg(oversizedValidDecimal).error, /226-byte/);
});

test('serializer rejects unsupported, overlong, subminimum and imprecise requests instead of repairing them', () => {
  for (const instructions of [[], [{action:'Reverse',durationS:1}], [{action:'Actuator',durationS:1}],
    [{action:'Forward',durationS:107}], [{action:'Pivot left',durationS:1.501}], [{action:'Forward',durationS:0.099}],
    [{action:'Forward',durationS:0.1001}], [{action:'Forward',durationS:2.0001}],
    Array.from({length:3}, () => ({action:'Forward',durationS:1}))]) assert.throws(() => serializeTimedLeg(instructions));
});

test('21.4 m at the fixed 0.25 m/s becomes an explicit short partial leg, never an 85.6-second upload', () => {
  const start = estimatedPosition([14.6094, 120.9896]);
  const target = [start.coords[0] + 21.4 / 6371000 * 180 / Math.PI, start.coords[1]];
  const plan = planMovementLeg({ start, heading: 0, target });
  assert.ok(Math.abs(plan.distanceM - 21.4) < 0.001);
  assert.equal(plan.partial, true);
  assert.equal(plan.totalS, 2);
  assert.equal(serializeTimedLeg(plan.instructions), 'TF2.000');
  assert.ok(validateTimedLeg('TF85.600').error);
  assert.ok(validateTimedLeg('TF107.000').error);
});

test('field-tested 45/90 degree pivots, 72 degree right pivot and 0.25 m forward serialize exactly', () => {
  const start = estimatedPosition([0, 121]);
  const target = [0.25 / 6371000 * 180 / Math.PI, 121];
  for (const [heading, expected] of [[0, 'TF1.000'], [45, 'TL0.400,TF1.000'], [315, 'TR0.400,TF1.000'],
    [90, 'TL0.800,TF1.000'], [270, 'TR0.800,TF1.000'], [288, 'TR0.640,TF1.000']]) {
    const plan = planMovementLeg({ start, heading, target });
    assert.equal(plan.error, undefined);
    assert.equal(plan.partial, false);
    assert.equal(serializeTimedLeg(plan.instructions), expected);
    assert.equal(validateTimedLeg(expected).error, undefined);
  }
});

test('one meter takes about four seconds total, but only the next two-second leg is offered', () => {
  const start = estimatedPosition([0, 121]);
  const target = [1 / 6371000 * 180 / Math.PI, 121];
  const plan = planMovementLeg({ start, heading: 0, target });
  assert.ok(Math.abs(plan.distanceM - 1) < 1e-9);
  assert.ok(Math.abs(plan.distanceM / 0.25 - 4) < 1e-9);
  assert.equal(plan.partial, true);
  assert.equal(serializeTimedLeg(plan.instructions), 'TF2.000');
});

test('planner applies hard pivot caps before forward movement and disables steps below 0.100 seconds', () => {
  const start = estimatedPosition([14.6094, 120.9896]);
  const target = [start.coords[0] + 0.001, start.coords[1]];
  const turn = planMovementLeg({start,heading:180,target});
  assert.equal(turn.partial, true);
  assert.equal(serializeTimedLeg(turn.instructions), 'TL1.500');
  assert.ok(planMovementLeg({start,heading:0,target:[start.coords[0] + 0.00000015,start.coords[1]]}).error);
});

const prepared = () => reduce(initialSupervisedMission(), {type:'CONFIRM_START',position:estimatedPosition([14.6,121]),heading:0,probeClear:true});
const awaiting = () => {
  let state = reduce(prepared(), {type:'BEGIN_UPLOAD'});
  state = reduce(state, {type:'RADIO_EVIDENCE',transmitted:true,acknowledged:true,telemetryRestored:true});
  return reduce(state, {type:'UPLOAD_READY'});
};
const startConfirmation = {type:'AUTHORIZE_TIMED_START',freshNeutral:true,armedHold:true,holdToSemi:true};

test('M2 transmission and ACK2 never authorize movement or verify Mega acceptance/execution', () => {
  let state = reduce(prepared(), {type:'BEGIN_UPLOAD'});
  assert.equal(state.phase, 'UPLOADING');
  state = reduce(state, {type:'RADIO_EVIDENCE',transmitted:true,acknowledged:true});
  assert.equal(reduce(state, {type:'UPLOAD_READY'}), state);
  assert.equal(reduce(state, startConfirmation), state);
  state = awaiting();
  assert.equal(state.phase, 'AWAITING_START');
  assert.equal(state.movementAuthorized, false);
  assert.equal(state.execution, 'UNVERIFIED');
  assert.equal(state.probeRetracted, true);
});

test('intentional physical HOLD to SEMI_AUTO authorization requires all three confirmations', () => {
  const state = awaiting();
  for (const key of ['freshNeutral','armedHold','holdToSemi']) assert.equal(reduce(state,{...startConfirmation,[key]:false}),state);
  const authorized = reduce(state,startConfirmation);
  assert.equal(authorized.phase,'EXECUTION_UNVERIFIED');
  assert.equal(authorized.movementAuthorized,true);
  assert.equal(authorized.execution,'UNVERIFIED');
  assert.equal(authorized.start,null);
  assert.equal(authorized.heading,null);
  assert.equal(reduce(authorized,{type:'TIMER_ELAPSED'}),authorized);
  assert.equal(reduce(authorized,{type:'MISSION_STATUS',status:'LEG_COMPLETE'}),authorized);
});

test('a timed leg requires stopped inspection and a new planning cycle before any further upload', () => {
  const authorized = reduce(awaiting(),startConfirmation);
  assert.equal(reduce(authorized,{type:'BEGIN_UPLOAD'}),authorized);
  assert.equal(reduce(authorized,{type:'AUTHORIZE_NEXT',authorized:true,index:0,pinCount:2}),authorized);
  assert.equal(reduce(authorized,{type:'INSPECT',stopped:false}),authorized);
  const inspected = reduce(authorized,{type:'INSPECT',stopped:true});
  assert.equal(inspected.phase,'INSPECTION');
  const replan = reduce(inspected,{type:'REPLAN'});
  assert.equal(replan.phase,'PLANNING');
  assert.equal(replan.start,null);
  assert.equal(replan.heading,null);
  assert.equal(replan.probeRetracted,false);
  assert.equal(reduce(replan,{type:'BEGIN_UPLOAD'}),replan);
});

test('closing an unsent upload returns to planning; closing possible delivery holds until inspection', () => {
  const upload = reduce(prepared(),{type:'BEGIN_UPLOAD'});
  assert.equal(reduce(upload,{type:'UPLOAD_CLOSED',deliveryPossible:false}).phase,'PLANNING');
  const held = reduce(awaiting(),{type:'UPLOAD_CLOSED',deliveryPossible:true});
  assert.equal(held.phase,'HELD');
  assert.equal(held.hold.source,'WORKFLOW');
  assert.equal(held.movementAuthorized,false);
  assert.equal(reduce(awaiting(),{type:'UPLOAD_CLOSED',deliveryPossible:false}).phase,'HELD');
});
