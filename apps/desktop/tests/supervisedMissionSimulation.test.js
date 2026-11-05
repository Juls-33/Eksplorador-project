import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRelativeMission } from '../src/utils/missionPlanning.js';
import { SupervisedMissionSimulation } from '../src/utils/supervisedMissionSimulation.js';

const origin = [14.609,120.989];
const point = (n,e) => [origin[0]+n/111195, origin[1]+e/(111195*Math.cos(origin[0]*Math.PI/180))];
const planFor = waypoints => createRelativeMission({waypoints, gps:{position:origin, valid:true, receivedAt:0, ageAtReceiptMs:0},
  heading:0, headingConfirmed:true, calibrationConfirmed:true, now:0});
function environment(route = [point(1,0)]) {
  const model = new SupervisedMissionSimulation(planFor(route));
  let now = 0;
  const step = (change = {}, action = 'tick', elapsed = 100) => {
    now += elapsed;
    const gpsPosition = model.tokens[model.index]?.startsWith('W')
      ? model.tokens[model.index].slice(1).split('.').map((v,i) => Number(v)/1e6-(i===0?90:180)) : origin;
    return model.step(now, {encoderCalibrated:true,turnCalibrated:true,forwardObstacle:false,
      rc:{valid:true,observedAt:now,authorized:true,mode:'SEMI_AUTO'},
      encoder:{valid:true,observedAt:now,step:model.index + 1,targetReached:true},
      gps:{valid:true,receivedAt:now,ageAtReceiptMs:0,position:gpsPosition},...change}, action);
  };
  const hold = () => step({rc:{valid:true,observedAt:now+100,authorized:true,mode:'HOLD'}});
  const start = () => { hold(); return step(); };
  return {model,step,hold,start};
}

for (const [name, route] of [['two pins',[point(1,0),point(1,1)]],['three pins',[point(2,0),point(2,2),point(0,2)]],
  ['four pins with turns',[point(2,0),point(2,2),point(0,2),point(0,0)]]]) {
  test(`simulated ${name} verifies every W before estimated completion`, () => {
    const env = environment(route); env.start();
    for (let i=0;i<100 && env.model.phase!=='COMPLETE';i++) env.step();
    assert.equal(env.model.phase,'COMPLETE');
    assert.equal(env.model.arrivals.length,route.length);
    assert.deepEqual(env.model.snapshot().physicalOutputs,{drive:false,extend:false,retract:false});
  });
}

test('uncalibrated mission waits; an already semi-auto switch cannot start; RC must be authorized', () => {
  const env = environment();
  assert.equal(env.step({encoderCalibrated:false}).phase,'WAIT_CALIBRATION');
  assert.equal(env.step({turnCalibrated:false}).phase,'WAIT_CALIBRATION');
  assert.equal(env.step().phase,'WAIT_RC_AUTH');
  env.hold();
  assert.equal(env.step({rc:{valid:true,observedAt:400,mode:'SEMI_AUTO',authorized:false}}).phase,'WAIT_RC_AUTH');
  assert.equal(env.step().phase,'WAIT_RC_AUTH');
  env.hold(); assert.equal(env.step().phase,'RUNNING_ENCODER');
});

test('encoder target completes movement without declaring GPS waypoint arrival', () => {
  const env = environment(); env.start();
  assert.equal(env.step({encoder:{valid:true,observedAt:300,step:99,targetReached:true}}).phase,'RUNNING_ENCODER');
  assert.equal(env.step().phase,'STEP_COMPLETE');
  assert.equal(env.model.arrivals.length,0);
  assert.equal(env.step().phase,'GPS_WAYPOINT_VERIFIED');
});

test('missed W holds and clears the mission; restored GPS and recovery cannot resume the old route', () => {
  const env = environment(); env.start(); env.step();
  const result = env.step({gps:{valid:true,receivedAt:400,ageAtReceiptMs:0,position:point(20,0)}});
  assert.equal(result.phase,'HOLD_LOCALIZATION'); assert.equal(result.reason,'MISSED_CHECKPOINT');
  assert.equal(env.step().phase,'HOLD_LOCALIZATION');
  const recovered = env.step({operatorApproved:true,rc:{valid:true,observedAt:600,authorized:true,mode:'HOLD'}},'recover');
  assert.equal(recovered.phase,'HOLD_LOCALIZATION');
  assert.equal(env.step().phase,'HOLD_LOCALIZATION');
  assert.equal(env.model.completedSteps.length,1);
  assert.equal(recovered.report.state,'HOLD'); assert.equal(recovered.step,2);
});

test('GPS loss permits only the current bounded encoder step; W cannot use uncalibrated dead reckoning', () => {
  const env = environment(); env.start();
  const loss = {gps:{valid:false}, deadReckoning:{valid:true,calibrated:true,position:point(1,0)}};
  assert.equal(env.step(loss).phase,'STEP_COMPLETE');
  assert.equal(env.model.arrivals.length,0);
  assert.equal(env.step(loss).phase,'HOLD_LOCALIZATION');
  assert.equal(env.step().phase,'HOLD_LOCALIZATION');
});

test('GPS interruption never permits unbounded movement or starts another encoder segment', () => {
  const env = environment([point(3,0)]); env.start();
  assert.equal(env.step({gps:null}).phase,'STEP_COMPLETE');
  assert.equal(env.step({gps:null}).phase,'HOLD_LOCALIZATION');
  const stalled = environment(); stalled.start();
  assert.equal(stalled.step({gps:null,encoder:{valid:true,observedAt:5300,step:0,targetReached:false}},'tick',5100).phase,'FAULT');
});

test('forward obstacle stops and holds; clearing never resumes or claims avoidance', () => {
  const env = environment(); env.start();
  assert.equal(env.step({forwardObstacle:true}).phase,'HOLD_OBSTACLE');
  assert.equal(env.step({forwardObstacle:false,operatorApproved:true},'recover').phase,'HOLD_OBSTACLE');
  assert.equal(env.model.arrivals.length,0);
});

test('RC disconnection, stale RC, HOLD and manual takeover cannot auto-resume', () => {
  for (const rc of [null,{valid:false},{valid:true,observedAt:0,authorized:true,mode:'SEMI_AUTO'},
    {valid:true,observedAt:1200,authorized:false,mode:'SEMI_AUTO'}, {valid:true,observedAt:1200,authorized:true,mode:'HOLD'}]) {
    const env=environment();env.start();
    assert.equal(env.step({rc},'tick',1000).phase,'HOLD_SAFETY');
    assert.equal(env.step().phase,'HOLD_SAFETY');
  }
  const env=environment();env.start();
  assert.equal(env.step({rc:{valid:true,observedAt:300,authorized:true,mode:'MANUAL'}}).phase,'MANUAL_OVERRIDE');
  assert.equal(env.step().phase,'MANUAL_OVERRIDE');
});

test('invalid sequences and missing encoder feedback fail closed; cancelled runs stay cancelled', () => {
  assert.throws(() => new SupervisedMissionSimulation({sequence:'F20,W0.0'}));
  const env=environment(); env.start();
  assert.equal(env.step({encoder:null}).phase,'HOLD_SAFETY');
  assert.equal(env.step({},'cancel').phase,'CANCELLED');
  assert.equal(env.step().phase,'CANCELLED');
});
