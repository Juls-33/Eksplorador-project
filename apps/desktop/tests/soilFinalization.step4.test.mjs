import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve('apps/desktop/src/views/FieldMapView.jsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const startMarker = 'const finalizeActiveInsertion = async (session) => {';
const start = source.indexOf(startMarker);
assert.notEqual(start, -1, 'Cannot locate finalizeActiveInsertion in FieldMapView.jsx');
const end = source.indexOf('\n  };', start);
assert.notEqual(end, -1, 'Cannot locate the end of finalizeActiveInsertion');
const fnSource = source.slice(start, end + '\n  };'.length).trim()
  .replace(/^const finalizeActiveInsertion\s*=\s*/, '').replace(/;$/, '');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {resolve = res; reject = rej;});
  return {promise, resolve, reject};
}
function tick() {return new Promise(resolve => setImmediate(resolve));}

function harness(opts={}) {
  const writes = [];
  const states = {live:[], field:[], ready:[], notifications:[], phase:[], missionUpdates:0, captured:false, saveCalls:0};
  const soilSessionRef = {current:null};
  const session = {
    id:'test-session-1', missionId:9, fieldName:'Test Field',
    startedAt:0, lastSeen:305000, readings:[{receivedAt:6000,data:{moisture:30,ph:7,ec:100}}],
    rawWrites:[], lastGps:[14.6,121.0],lastGpsSeenAt:305000,
    finalizing:false,completed:false
  };
  soilSessionRef.current=session;
  const saveMock=opts.saveMock ?? (async () => true);
  const deps={
    soilSessionRef,
    samplingPhase: () => ({phase:'finalize'}),
    summarizeSoilSession: () => ({count:3, moisture:30,ph:7,ec:100,nitrogen:10,phosphorus:20,potassium:30}),
    MIN_AVERAGE_READINGS:3,
    resolveSoilSampleLocation: () => ({outsideField:false,coords:[14.6,121],source:'GPS'}),
    manualSoilLocationEnabled:false,
    manualSoilLocation:null,
    activeBoundary:null,
    setNotification: item => states.notifications.push(item),
    setSoilSessionStatus: item => states.phase.push(item),
    saveSoilSample: async (...args)=>{ states.saveCalls++; writes.push(args[0]); return saveMock(...args); },
    setLiveSamples: callback => {states.live=callback(states.live);},
    setFieldSamples: callback => {states.field=callback(states.field);},
    setMissions: callback => { states.missionUpdates++; callback([{id:9,sampleCount:0}]);},
    setReadySoilSample: item => states.ready.push(item),
    setManualSoilLocation: () => {},
    sampleCapturedForInsertionRef: {set current(x){states.captured=x;},get current(){return states.captured;}},
    currentSelected:{name:'Test Mission'},
    SOIL_LOCATION_SOURCE:{GPS:'GPS'}
  };
  const names=Object.keys(deps);
  // Evaluate the EXACT function declaration from FieldMapView.jsx with isolated mocks;
  // no React mounting, Tauri connections, or production DB calls.
  const create=Function(...names, `return (${fnSource});`);
  const finalize=create(...names.map(n=>deps[n]));
  return {session,soilSessionRef,states,writes,finalize};
}

test('SW03-STEP4D1: simultaneous completion triggers only one save',async()=>{
  const gate=deferred();
  const h=harness({saveMock:()=>gate.promise});
  const first=h.finalize(h.session);
  const second=h.finalize(h.session);
  await tick();
  assert.equal(h.states.saveCalls,1);
  assert.equal(h.session.finalizing,true);
  gate.resolve(true);
  await Promise.all([first,second]);
  assert.equal(h.states.live.length,1);
  assert.equal(h.states.field.length,1);
  assert.equal(h.session.completed,true);
  assert.equal(h.session.finalizing,false);
});

test('SW03-STEP4D2: cancellation during pending raw writes prevents final insert',async()=>{
  const raw=deferred();
  const h=harness();
  h.session.rawWrites.push(raw.promise);
  const finalizing=h.finalize(h.session);
  await tick();
  h.soilSessionRef.current=null;
  raw.resolve();
  await finalizing;
  assert.equal(h.states.saveCalls,0);
  assert.equal(h.states.live.length,0);
  assert.equal(h.session.completed,false);
  assert.equal(h.session.finalizing,false);
});

test('SW03-STEP4D3: cancel during DB save suppresses stale UI success',async()=>{
  const gate=deferred();
  const h=harness({saveMock:()=>gate.promise});
  const finalizing=h.finalize(h.session);
  await tick();
  assert.equal(h.states.saveCalls,1);
  h.soilSessionRef.current=null;
  gate.resolve(true);
  await finalizing;
  assert.equal(h.states.live.length,0);
  assert.equal(h.states.field.length,0);
  assert.equal(h.states.ready.length,0);
  assert.equal(h.states.missionUpdates,0);
  assert.equal(h.states.captured,false);
  assert.equal(h.session.completed,false);
  assert.equal(h.session.finalizing,false);
  // This test intentionally does NOT assert that an already initiated DB commit is rolled back.
});

test('SW03-STEP4D4: completed session cannot finalize again',async()=>{
  const h=harness();
  await h.finalize(h.session);
  await h.finalize(h.session);
  assert.equal(h.states.saveCalls,1);
  assert.equal(h.states.live.length,1);
});

test('SW03-STEP4D5: failed persistence cannot claim success',async()=>{
  const h=harness({saveMock:async()=>null});
  await h.finalize(h.session);
  assert.equal(h.states.saveCalls,1);
  assert.equal(h.session.completed,false);
  assert.equal(h.states.live.length,0);
  assert.ok(h.states.notifications.some(n=>n.type==='error'));
  assert.equal(h.session.finalizing,false);
});
