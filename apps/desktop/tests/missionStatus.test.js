import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createLoRaConnectionStore } from '../src/services/loraConnectionStore.js';
import { describeMissionStatus } from '../src/utils/missionStatus.js';

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
  assert.doesNotMatch(html, /Mission accepted for staging|reports mission completion/);
});

test('staging report carries exact acceptance language, mission ID and historical reconnect context', () => {
  const deployment = {mega_status:status, status_connection_confirmed:false};
  const html = render(Report, {deployment, connected:true});
  assert.match(html, /Mission accepted for staging\. Autonomous navigation remains disabled pending calibration\./);
  assert.match(html, /0123456789ABCDEF/);
  assert.match(html, /Historical report; awaiting confirmation after reconnection/);
  assert.doesNotMatch(render(Report, {deployment:{...deployment,status_connection_confirmed:true}, connected:true}), /Historical report/);
});

test('future execution, pause, fault, rejection and completion describe only explicit Mega evidence', () => {
  for (const [state, expected] of [['REJECTED',/Mega rejected/], ['NAVIGATING',/navigation in progress/],
    ['PAUSED',/mission paused/], ['FAULT',/mission fault/], ['COMPLETE',/reports mission completion/],
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

test('operator planning requires real GPS and a heading assumption rather than default coordinates or gyro rate', () => {
  const props = {waypoints:[[14.61,120.99]], onSendMission:() => {}};
  const missing = render(Guide, props);
  assert.match(missing, /Waiting for real GPS coordinates/);
  assert.doesNotMatch(missing, /IN RANGE|R\d+,F\d+|All Waypoint Objectives Traversed/);
  const noHeading = render(Guide, {...props, roverPos:[14.6094,120.9896]});
  assert.match(noHeading, /No movement commands generated/);
  assert.match(noHeading, /operator supplied/);
  const known = render(Guide, {...props, roverPos:[14.6094,120.9896], roverHeading:0});
  assert.match(known, /R\d+,F[\d.]+/);
  assert.match(known, /staging only/);
});

test('simulation and manual expose staging-only behavior without arming instructions in mission handoff', () => {
  assert.match(render(Panel, {waypoints:[[14.61,120.99]]}), /no hardware commands/);
  const manual = render(Manual, {initialGuideId:'rover'});
  assert.match(manual, /Mission Staging \(A2.9\)/);
  assert.match(manual, /Autonomous navigation remains disabled/);
  assert.doesNotMatch(manual, /Once the system is ready and the surroundings are safe/);
});
