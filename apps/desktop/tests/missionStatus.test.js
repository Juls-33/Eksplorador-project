import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createLoRaConnectionStore } from '../src/services/loraConnectionStore.js';
import { describeMissionStatus, missionEvidence, missionStepEvidence } from '../src/utils/missionStatus.js';

let server, Report, Guide, Panel, Manual;
before(async () => {
  server = await createServer({configFile:false, root:fileURLToPath(new URL('../', import.meta.url)),
    optimizeDeps:{noDiscovery:true, include:[]}, server:{middlewareMode:true, ws:false, hmr:false, watch:null}});
  Report = (await server.ssrLoadModule('/src/components/MissionStatusReport.jsx')).default;
  Guide = (await server.ssrLoadModule('/src/components/OperatorNavGuide.jsx')).default;
  Panel = (await server.ssrLoadModule('/src/components/MissionSimulationPanel.jsx')).default;
  Manual = (await server.ssrLoadModule('/src/views/UserManualView.jsx')).default;
});
after(async () => { await server?.close(); });
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const status = {missionId:'0123456789ABCDEF', statusSeq:1, state:'STAGED', reason:'NAV_NOT_CALIBRATED', step:0};

test('ACK and upload completion cannot claim staging, execution, sampling, or mission completion', () => {
  const html = render(Report, {deployment:{acknowledged:true, phase:'COMPLETE'}, connected:true});
  assert.match(html, /UART queue/);
  assert.match(html, /Waiting for Mega mission staging or rejection/);
  assert.doesNotMatch(html, /Mega staged mission\. Await|reports mission completed as/);
});

test('staging report carries exact acceptance language, mission ID and historical reconnect context', () => {
  const deployment = {mega_status:status, status_connection_confirmed:false};
  const html = render(Report, {deployment, connected:true,advanced:true});
  assert.match(html, /Waiting for encoder\/turn calibration/);
  assert.match(html, /0123456789ABCDEF/);
  assert.match(html, /Historical report; awaiting confirmation after reconnection/);
  assert.doesNotMatch(render(Report, {deployment:{...deployment,status_connection_confirmed:true}, connected:true}), /Historical report/);
});

test('future execution, pause, fault, rejection and completion describe only explicit Mega evidence', () => {
  for (const [state, expected] of [['REJECTED',/Mega rejected/], ['NAVIGATING',/encoder-controlled movement/],
    ['PAUSED',/held, cancelled, or faulted/], ['FAULT',/held, cancelled, or faulted/], ['COMPLETE',/completed as an estimated route/],
    ['HOLD_LOCALIZATION',/localization hold/], ['UNKNOWN_FUTURE_STATE',/Mega reports UNKNOWN_FUTURE_STATE/]]) {
    assert.match(describeMissionStatus({mega_status:{...status,state}}), expected);
  }
});

test('shared connection snapshots retain matching status and reject older pre-reconnect snapshots', async () => {
  let accept;
  const pending = new Promise(() => {});
  const store = createLoRaConnectionStore({listen:async (_,fn) => {accept = fn; return () => {};}, invoke:() => pending});
  const stop = store.subscribe(() => {});
  await new Promise(resolve => setImmediate(resolve));
  const deployment = {id:12, mega_status:status, status_connection_confirmed:true};
  accept({payload:{revision:5, connected:true, deployment}});
  accept({payload:{revision:6, connected:false, deployment:{...deployment,status_connection_confirmed:false}}});
  accept({payload:{revision:5, connected:true, deployment}});
  assert.equal(store.getSnapshot().connected, false);
  assert.equal(store.getSnapshot().deployment.mega_status.missionId, status.missionId);
  assert.equal(store.getSnapshot().deployment.status_connection_confirmed, false);
  stop();
});

test('coordinate delivery does not require GPS or calibration confirmations and exposes no fake compatibility checkboxes',()=>{
 const html=render(Guide,{waypoints:[[14.61,120.99],[14.611,120.991]],onSendMission:()=>{}});
 assert.match(html,/Send Mission/);assert.match(html,/GPS is not needed for delivery/);
 assert.doesNotMatch(html,/type="checkbox"/);assert.doesNotMatch(html,/disabled=""/);
 assert.match(html,/deliberate RC HOLD-to-SEMI_AUTO/);
 assert.match(html,/Developer Tools/);
});

test('simulation and manual explain supervised A3.0 authorization and its limits', () => {
  assert.match(render(Panel, {waypoints:[[14.61,120.99]]}), /no hardware commands/);
  const manual = render(Manual, {initialGuideId:'rover'});
  assert.match(manual, /Waypoint Missions \(N1\)/);
  assert.match(manual, /verifies arrival separately from encoder completion/);
  assert.match(manual, /Automatic soil sampling is disabled/);
});

test('encoder completion, ACK and estimated completion never manufacture GPS verification evidence', () => {
  const deployment = {acknowledged:true,phase:'COMPLETE',radio_transmitted:true,
    mega_status:{...status,state:'COMPLETE'}, status_history:[{...status,state:'STEP_COMPLETE'},{...status,state:'COMPLETE',statusSeq:2}]};
  assert.equal(missionEvidence(deployment).find(([name]) => name === 'GPS waypoint verified')[1], 'Unverified');
  assert.match(describeMissionStatus({mega_status:{...status,state:'STEP_COMPLETE'}}),/not proof of GPS/);
  assert.match(describeMissionStatus(deployment),/does not establish that every GPS waypoint was verified/);
});

test('obstacle, localization and missed-status reports expose holds and uncertainty', () => {
  assert.match(describeMissionStatus({mega_status:{...status,state:'HELD',reason:'FORWARD_OBSTACLE'}}), /does not automatically resume/);
  assert.match(describeMissionStatus({mega_status:{...status,state:'HOLD_LOCALIZATION'}}), /cannot be verified/);
  const html = render(Report,{deployment:{mega_status:status,status_packets_missing:3},connected:false});
  assert.match(html,/Some mission events were missed/);
  assert.match(html,/freshness is unconfirmed/);
});

test('each movement and GPS checkpoint stays unverified until an explicit report matches its token index', () => {
  const deployment = {sequence:'F1,W104609000.300989000,R90,F1,W104609010.300989000',
    mega_status:{...status,state:'PIN_CHECKED',step:1,reason:'GPS_WITHIN_5M'},status_history:[
      {...status,state:'STEP_DONE',step:1,reason:'ENCODER_ESTIMATE'},
      {...status,state:'PIN_CHECKED',step:1,statusSeq:2,reason:'GPS_WITHIN_5M'}, // cannot verify a movement token
      {...status,state:'PIN_CHECKED',step:2,statusSeq:3,reason:'GPS_WITHIN_5M'},
      {...status,state:'COMPLETE',step:5,statusSeq:5},
    ]};
  const evidence = missionStepEvidence(deployment);
  assert.equal(evidence[0].evidence,'Encoder target completion reported');
  assert.equal(evidence[1].evidence,'GPS verification reported');
  assert.equal(evidence[2].evidence,'Movement completion unverified');
  assert.equal(evidence[4].evidence,'GPS arrival unverified');
  assert.equal(evidence[1].pin,1); assert.equal(evidence[4].pin,2);
  assert.equal(evidence[0].step,1); assert.equal(evidence[4].step,5);
  assert.match(describeMissionStatus(deployment),/step does not match a known W/);
  const maximum={sequence:`${'F1,'.repeat(39)}W104609000.300989000`,mega_status:{...status,state:'PIN_CHECKED',step:40,reason:'GPS_WITHIN_5M'}};
  assert.equal(missionStepEvidence(maximum)[39].evidence,'GPS verification reported');
  assert.equal(missionStepEvidence(maximum)[39].pin,1);
});

test('a long two-leg route sends two coordinates rather than 55 forward movement segments',()=>{
 const base=[14.609,120.989];const route=[[base[0]+49.5/111195,base[1]],[base[0]+49.5/111195,base[1]+32.8/(111195*Math.cos(base[0]*Math.PI/180))]];
 const html=render(Guide,{waypoints:route,onSendMission:()=>{}});
 assert.match(html,/2 waypoint targets/);assert.doesNotMatch(html,/Route capacity exceeded|forward segments|disabled=""/);
});

test('actual Mega states RUNNING, STEP_DONE, PIN_CHECKED, HOLD, COMPLETE and STAGED have explicit meanings', () => {
  const deployment={sequence:'F1,W104609000.300989000',status_history:[]};
  const cases=[['STAGED',0,'WAIT_SEMIAUTO_EDGE',/Waiting for deliberate RC/],
    ['STAGED',0,'CALIBRATION_REQUIRED',/Waiting for encoder\/turn/],['RUNNING',0,'OPERATOR_STARTED',/running encoder/],
    ['RUNNING',1,'ENCODER_TARGET',/running encoder/],['STEP_DONE',1,'ENCODER_ESTIMATE',/not proof of GPS/],
    ['PIN_CHECKED',2,'GPS_WITHIN_5M',/GPS waypoint verified/],['HOLD',2,'GPS_NO_VALID_ARRIVAL',/cannot be verified/],
    ['HOLD',2,'WAYPOINT_NOT_REACHED',/new staged mission/],['HOLD',1,'OBSTACLE_DETECTED',/does not automatically resume/],
    ['HOLD',1,'CALIBRATION_REQUIRED',/Waiting for encoder\/turn/],['HOLD',1,'SONAR_UNKNOWN',/sonar is unavailable/],
    ['COMPLETE',2,'PATH_ESTIMATE_ONLY',/estimated route/]];
  for(const [state,step,reason,expected] of cases) assert.match(describeMissionStatus({...deployment,mega_status:{...status,state,step,reason}}),expected);
  assert.match(describeMissionStatus({...deployment,mega_status:{...status,state:'PIN_CHECKED',step:0,reason:'GPS_WITHIN_5M'}}),/arrival remains unverified/);
});
