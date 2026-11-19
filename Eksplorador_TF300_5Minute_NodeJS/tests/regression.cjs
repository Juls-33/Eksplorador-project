'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const pkg=path.resolve(__dirname,'..');
const f=require('../apply_tf300.js');
const fixture=path.join(pkg,'fixtures');
function makeProject() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eksplorador-tf300-'));
  fs.cpSync(fixture,root,{recursive:true});
  return {root, mega:'embedded/mega/semi-autonomous.ino'};
}
function file(root,rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function runCli(root,others=[]){return cp.spawnSync(process.execPath,[path.join(pkg,'apply_tf300.js'),root,...others],{encoding:'utf8'});}
function patched(){ const pr=makeProject();f.apply(pr.root,{mega:pr.mega});return pr; }
const originals={
  planner:'apps/desktop/src/utils/pointToPointMission.js',
  dialog:'apps/desktop/src/components/PointToPointMissionDialog.jsx',
  wizard:'apps/desktop/src/components/MissionDeploymentWizard.jsx',
  rust:'apps/desktop/src-tauri/src/mission_protocol.rs',
  mega:'embedded/mega/semi-autonomous.ino',
};
function createPlanner(s) {
  return new Function('calculateBearing','calculateDistance',
    s.replace(/^import .*?;$/mg,'').replace(/^export /mg,'')+';return {makeStraightLeg,MAX_LEG_S};'
  )(()=>0, (a,b)=>Math.abs(b[0]-a[0])*1000);
}
test('Mega patch changes only two bounding constants; all safety logic preserved byte-for-byte',()=>{
  const s=fs.readFileSync(path.join(fixture,originals.mega),'utf8');
  const updated=f.patchMega(s);
  assert.equal(updated.replace('A31_MAX_STEP_MS = 300000','A31_MAX_STEP_MS = 60000').replace('A31_MAX_LEG_MS  = 300000','A31_MAX_LEG_MS  = 120000'),s);
  assert.match(updated,/A31_MAX_STEP_MS\s*=\s*300000/);
  assert.match(updated,/A31_MAX_LEG_MS\s*=\s*300000/);
  assert.match(updated,/A31_MAX_TURN_MS\s*=\s*1500/);
  assert.match(updated,/A31_PAUSE_MAX_MS\s*=\s*30000/);
  assert.match(updated,/ENC_LEFT_FORWARD_SIGN\s*=\s*-1/);
  assert.match(updated,/ENC_RIGHT_FORWARD_SIGN\s*=\s*\+1/);
  assert.match(updated,/BENCH_NO_ECHO_IS_CLEAR/);
});
test('Timed planner accepts 5-minute boundary as TF300.000',()=>{
  const p=createPlanner(f.patchPlanner(file(fixture,originals.planner)));
  const plan=p.makeStraightLeg({start:{coords:[14.6,120.9],source:'MANUAL'},target:[14.675,120.9],pinIndex:0});
  assert.equal(p.MAX_LEG_S,300);
  assert.equal(plan.sequence,'TF300.000');
  assert.equal(plan.partial,false);
  assert.ok(Math.abs(plan.estimatedLegM-75)<1e-7);
});
test('Timed planner accepts 60 and 180 seconds, keeps 3 decimal places',()=>{
  const p=createPlanner(f.patchPlanner(file(fixture,originals.planner)));
  for(const secs of [0.1,30,60,180,299.999]) {
    const target=[14.6+secs*.25/1000,120.9];
    assert.equal(p.makeStraightLeg({start:{coords:[14.6,120.9],source:'MANUAL'},target,pinIndex:0}).sequence,`TF${secs.toFixed(3)}`);
  }
});
test('Timed planner rejects more than 300 seconds instead of truncating',()=>{
  const p=createPlanner(f.patchPlanner(file(fixture,originals.planner)));
  for(const secs of [300.001,301,600]) {
    assert.throws(()=>p.makeStraightLeg({start:{coords:[14.6,120.9],source:'MANUAL'},target:[14.6+secs*.25/1000,120.9],pinIndex:0}),/Choose a closer destination/);
  }
});
test('Timed planner still rejects invalid map positions and too-close points',()=>{
  const p=createPlanner(f.patchPlanner(file(fixture,originals.planner)));
  assert.throws(()=>p.makeStraightLeg({start:{coords:[14.6,120.9],source:'MANUAL'},target:[0,0],pinIndex:0}),/valid destination/);
  assert.throws(()=>p.makeStraightLeg({start:{coords:[14.6,120.9],source:'MANUAL'},target:[14.6,120.9],pinIndex:0}),/too close/);
});
test('Rust validator bound and tests cover 300.000 yes, 300.001 no',()=>{
  const s=f.patchRust(file(fixture,originals.rust));
  assert.match(s,/MAX_TIMED_LEG_SECONDS:\s*f64\s*=\s*300.000/);
  assert.match(s,/"TF299.999", "TF300.000"/);
  assert.match(s,/"TF300.001", "TF301.000"/);
  assert.match(s,/TF0.100–TF300.000/);
  assert.match(s,/sequence.len\(\) > 9/); // 'TF300.000' is exactly 9 bytes
});
test('Deployment wizard updates maximum and retains HOLD/DISARM workflow',()=>{
  const s=f.patchWizard(file(fixture,originals.wizard));
  assert.match(s,/up to 300 seconds \(5 minutes\)/);
  assert.match(s,/CH6/);
  assert.match(s,/HOLD \/ DISARM/);
  assert.match(s,/MAX_LEG_S/);
});
test('Dialog includes visible extended command caution without relaxing checkboxes',()=>{
  const s=f.patchDialog(file(fixture,originals.dialog));
  assert.match(s,/plan.durationS > 60/);
  assert.match(s,/bench ultrasonic profile must not be used/);
  assert.match(s,/probeClear && pathClear/);
  assert.match(s,/freshFusionStart/);
});
test('Dry-run never changes project source bytes',()=>{
  const {root,mega}=makeProject();
  const before=Object.values(originals).map(rel=>file(root,rel));
  const r=runCli(root,['--dry-run','--mega',mega]);
  assert.equal(r.status,0,r.stderr);
  assert.equal((r.stdout.match(/WOULD PATCH/g)||[]).length,5);
  assert.deepEqual(Object.values(originals).map(rel=>file(root,rel)),before);
  assert.ok(!fs.existsSync(path.join(root,'backups')));
});
test('Real installation patches exactly 5 planned files and creates backups',()=>{
  const {root,mega}=makeProject();
  const r=runCli(root,['--mega',mega]);
  assert.equal(r.status,0,r.stderr);
  assert.equal((r.stdout.match(/^PATCH:/mg)||[]).length,5);
  for(const rel of Object.values(originals)) {
    const s=file(root,rel);
    assert.notEqual(s,file(fixture,rel));
  }
});
test('Repeat installation is idempotent',()=>{
  const {root,mega}=makeProject();
  const first=runCli(root,['--mega',mega]); assert.equal(first.status,0,first.stderr);
  const before=Object.values(originals).map(rel=>file(root,rel));
  const second=runCli(root,['--mega',mega]);assert.equal(second.status,0,second.stderr);
  assert.equal((second.stdout.match(/ALREADY PATCHED/g)||[]).length,5);
  assert.deepEqual(Object.values(originals).map(rel=>file(root,rel)),before);
});
test('Missing Rust anchor rejects before any modifications',()=>{
  const {root,mega}=makeProject();
  const rust=path.join(root,originals.rust);
  fs.writeFileSync(rust,fs.readFileSync(rust,'utf8').replace('MAX_TIMED_LEG_SECONDS: f64 = 60.000','MAX_TIMED_LEG_SECONDS: f64 = 0.000'));
  const before=Object.values(originals).map(rel=>file(root,rel));
  const r=runCli(root,['--mega',mega]);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Rust limit/);
  assert.deepEqual(Object.values(originals).map(rel=>file(root,rel)),before);
});
test('Unrecognized/older Mega firmware rejected; no frontend changes',()=>{
  const {root,mega}=makeProject();
  const p=path.join(root,mega);
  fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('sonarBenchCheckPending','UNRECOGNIZED_SONAR_STATE'));
  const before=file(root,originals.planner);
  const r=runCli(root,['--mega',mega]);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Mega version mismatch/);
  assert.equal(file(root,originals.planner),before);
});
test('Ambiguous Mega versions require explicit path to avoid wrong flash source',()=>{
  const {root,mega}=makeProject();
  const extra=path.join(root,'embedded','archive','legacy.ino');
  fs.mkdirSync(path.dirname(extra),{recursive:true});
  fs.copyFileSync(path.join(root,mega),extra);
  const r=runCli(root,['--dry-run']);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Expected one matching/);
  const explicit=runCli(root,['--dry-run','--mega',mega]);
  assert.equal(explicit.status,0,explicit.stderr);
});
test('Planner retains GPS freshness validation, compatible with GPS fallback patch',()=>{
  const s=f.patchPlanner(file(fixture,originals.planner));
  assert.match(s,/GPS_FRESH_MS = 5000/);
  assert.match(s,/freshFusionStart\(gps, now\)/);
  assert.match(s,/source: 'GPS'/);
  const gpsLike=file(fixture,originals.planner).replace("import { calculateBearing, calculateDistance } from './geo.js';", "import { calculateBearing, calculateDistance } from './geo.js';\n// EKSPLORADOR_GPS_MISSION_FIX_V1")
    .replace("if (!fix || fix.source !== 'fusion'", "if (!fix || !['fusion','telemetry'].includes(fix.source)");
  const again=f.patchPlanner(gpsLike);
  assert.match(again,/MAX_LEG_S = 300.000/);
  assert.match(again,/GPS_MISSION_FIX_V1/);
});
test('Node installer syntax accepted',()=>{
  const r=cp.spawnSync(process.execPath,['--check',path.join(pkg,'apply_tf300.js')],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
});
