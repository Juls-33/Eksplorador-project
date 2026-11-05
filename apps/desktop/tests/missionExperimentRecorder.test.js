import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMissionExperimentRecorder } from '../src/services/missionExperimentRecorder.js';
import { createRelativeMission } from '../src/utils/missionPlanning.js';
import {createWaypointMission} from '../src/utils/waypointMission.js';

const origin=[14.609,120.989];
const plan = () => createRelativeMission({waypoints:[origin], gps:{position:origin,valid:true,receivedAt:1000,ageAtReceiptMs:0},
  heading:0,headingConfirmed:true,calibrationConfirmed:true,now:1000});
test('export preserves expected coordinates, mission identity, timestamps and raw GPS/encoder/status data across views', async () => {
  const handlers = new Map(); let time=1000;
  const recorder=createMissionExperimentRecorder({clock:()=>time,listen:async (name,fn)=>{handlers.set(name,fn);return ()=>handlers.delete(name);}});
  const route=plan(); await recorder.start(route); recorder.bindDeployment(123);
  route.legs[0].coordinates[0]=0;
  const unmount=recorder.subscribe(()=>{}); unmount(); // navigation must not end collection
  const sensor={type:'fusion',positionSource:'GPS_ONLY',fusionSeq:1,lat:14.609,lng:120.989,gpsValid:1,gpsAgeMs:0};
  handlers.get('fusion-data')({payload:sensor}); sensor.lat=0;
  time=1100; handlers.get('encoder-data')({payload:{leftTicks:123,rightTicks:120,encoderSeq:1}});
  handlers.get('fusion-data')({payload:{type:'fusion',encoderValid:1}});
  handlers.get('rx-board-connection')({payload:{deployment:{id:123,mega_status:{state:'STEP_COMPLETE'}}}});
  const log=recorder.export();
  assert.deepEqual(log.plan.legs[0].coordinates,origin);
  assert.equal(log.missionId,123);
  assert.equal(log.records[0].observedAt,1000);
  assert.equal(log.records[0].payload.lat,14.609);
  assert.equal(log.records[0].comparison[0].result,'WITHIN_COMPARISON_RADIUS');
  assert.equal(log.records[1].payload.leftTicks,123);
  assert.equal(log.records.length,4);
  assert.equal(log.plan.sequence,'W104609000.300989000');
  assert.equal(log.schema,'eksplorador-feedback-navigation-v1');
  assert.equal(log.statusStepBase,1); assert.equal(log.stagingStep,0);
  assert.equal(log.plan.legs[0].checkpointStep,1); assert.equal(log.gpsSource,'fusion');
  await recorder.start(plan());
  assert.equal(recorder.getSnapshot().archives,1);
  assert.equal(recorder.export().archivedRuns[0].records.length,4);
  assert.throws(()=>recorder.clear(),/Stop recording/);
  recorder.stop(); assert.equal(handlers.size,0);
  recorder.clear(); assert.equal(recorder.getSnapshot().plan,null);
});

test('invalid/missing GPS metadata stays unverified and duplicates remain raw; full logs explicitly count loss', async () => {
  const handlers=new Map(); const recorder=createMissionExperimentRecorder({limit:2,clock:()=>1000,listen:async (name,fn)=>{handlers.set(name,fn);return ()=>{};}});
  await recorder.start(plan());
  const packet={type:'fusion',positionSource:'GPS_ONLY',lat:14.609,lng:120.989,fusionSeq:1};
  handlers.get('fusion-data')({payload:packet}); handlers.get('fusion-data')({payload:packet});
  handlers.get('encoder-data')({payload:{leftTicks:20}});
  const log=recorder.export();
  assert.equal(log.records.length,2);assert.equal(log.droppedRecords,1);
  assert.equal(log.records[0].comparison[0].result,'GPS_UNVERIFIED');
  recorder.stop();
});

test('N1 export tracks matching pose epochs and valid GPS separately, archives runs and clears all session data',async()=>{
  const handlers=new Map();
  const recorder=createMissionExperimentRecorder({clock:()=>1000,listen:async(name,fn)=>{handlers.set(name,fn);return()=>handlers.delete(name);}});
  await recorder.start(createWaypointMission([origin]));recorder.bindDeployment(123);
  const navigation={bootId:1,navSeq:1,missionId:'000000000000007B',poseValid:true,estimatedLat:14.609,estimatedLng:120.989,positionUncertaintyM:3};
  const nav=n=>handlers.get('rx-board-connection')({payload:{navigation:n}});
  nav(navigation);nav(navigation);nav({...navigation,bootId:2});
  nav({...navigation,navSeq:2,missionId:'000000000000007C'});
  handlers.get('fusion-data')({payload:{type:'fusion',positionSource:'GPS_ONLY',fusionSeq:1,lat:14.609,lng:120.989,gpsValid:1,gpsAgeMs:0}});
  const log=recorder.export();assert.equal(log.statusStepMeaning,'WAYPOINT_INDEX');
  assert.equal(log.poseTrack.length,2);assert.equal(log.gpsTrack.length,1);assert.equal(log.records.length,5);
  await recorder.start(createWaypointMission([origin]));assert.equal(recorder.export().archivedRuns.length,1);
  recorder.stop();recorder.clear();assert.equal(recorder.export().archivedRuns.length,0);
});

test('partial subscription failure stops all installed listeners and blocks silent capture loss', async () => {
  let stopped=0;
  const recorder=createMissionExperimentRecorder({listen:async name=>{
    if(name==='encoder-data') throw new Error('missing event'); return ()=>{stopped++;};
  }});
  await assert.rejects(()=>recorder.start(plan()),/could not subscribe/);
  assert.equal(stopped,3); assert.equal(recorder.getSnapshot().recording,false);
});

test('stopping during listener setup cannot leak subscriptions or open a deployment without a recording', async () => {
  const releases=[];let stopped=0;
  const recorder=createMissionExperimentRecorder({listen:()=>new Promise(resolve=>releases.push(()=>resolve(()=>{stopped++;})))});
  const start=recorder.start(plan());
  recorder.stop();recorder.clear();
  releases.forEach(release=>release());
  await assert.rejects(()=>start,/stopped before subscriptions/);
  assert.equal(stopped,4);
  assert.equal(recorder.getSnapshot().plan,null);
});
