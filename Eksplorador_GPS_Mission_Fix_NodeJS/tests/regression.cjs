'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {apply}=require('../apply_gps_mission_fix.js');
const ROOT=path.resolve(__dirname,'..');
const project=fs.mkdtempSync(path.join(os.tmpdir(),'eksplorador-gps-'));
const files=['apps/desktop/src/utils/pointToPointMission.js', 'apps/desktop/src/components/PointToPointMissionDialog.jsx', 'apps/desktop/src/views/FieldMapView.jsx'];
let passed=0;
function test(name,fn){fn(); console.log('PASS', name);passed++;}
function copy(){for(const f of files){const to=path.join(project,f);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(ROOT,'fixtures',f),to);}}
copy();
const old=new Map(files.map(f=>[f,fs.readFileSync(path.join(project,f),'utf8')]));
test('dry run touches no files',()=>{apply(project,true,()=>{});for(const f of files)assert.equal(fs.readFileSync(path.join(project,f),'utf8'),old.get(f))});
test('installs all three React GPS files',()=>{let p=apply(project,false,()=>{});assert.equal(p.filter(x=>!x.already).length,3);for(const f of files)assert.match(fs.readFileSync(path.join(project,f),'utf8'),/EKSPLORADOR_GPS_MISSION_FIX_V1/)});
test('rerun is idempotent',()=>{const before=files.map(f=>fs.readFileSync(path.join(project,f),'utf8'));apply(project,false,()=>{});files.forEach((f,i)=>assert.equal(fs.readFileSync(path.join(project,f),'utf8'),before[i]));});
const code=fs.readFileSync(path.join(project,files[0]),'utf8')
 .replace(/^import \{ calculateBearing, calculateDistance \} from '\.\/geo\.js';/m,'')
 .replace(/\bexport /g,'');
const ctx={calculateBearing:()=>90,calculateDistance:()=>2,Date};
vm.runInNewContext(code+'\nthis.GPS={freshFusionStart, choosePlanningGps, makeStraightLeg, GPS_FRESH_MS, MAX_LEG_S};',ctx);
const {freshFusionStart,choosePlanningGps,makeStraightLeg,MAX_LEG_S,GPS_FRESH_MS}=ctx.GPS;
const NOW=100000;
const mk=(source, overrides={})=>({source,valid:true,position:[14.608,120.989],receivedAt:NOW-200,ageAtReceiptMs:100,satsLocked:7,...overrides});
test('valid fresh FUS takes priority',()=>assert.equal(choosePlanningGps(mk('fusion'),mk('telemetry'),NOW).source,'fusion'));
test('valid sensor DATA GPS used when FUS unavailable',()=>{let r=choosePlanningGps(null,mk('telemetry'),NOW);assert.equal(r.source,'telemetry');let p=freshFusionStart(r,NOW);assert.equal(p.fixSource,'telemetry');assert.deepEqual([...p.coords],[14.608,120.989]);});
test('fresh DATA fallback when FUS stale',()=>{const r=choosePlanningGps(mk('fusion',{receivedAt:NOW-9000}),mk('telemetry'),NOW);assert.equal(r.source,'telemetry')});
test('fresh DATA fallback when FUS invalid',()=>assert.equal(choosePlanningGps(mk('fusion',{valid:false}),mk('telemetry'),NOW).source,'telemetry'));
test('reject zero coordinates and malformed positions',()=>{assert.equal(freshFusionStart(mk('telemetry',{position:[0,0]}),NOW),null);assert.equal(freshFusionStart(mk('telemetry',{position:[91,100]}),NOW),null);});
test('reject sensor GPS with zero, negative or missing satellites',()=>{for(const n of [0,-1,undefined,2.5])assert.equal(freshFusionStart(mk('telemetry',{satsLocked:n}),NOW),null)});
test('reject stale, future, or aged GPS',()=>{assert.equal(freshFusionStart(mk('telemetry',{receivedAt:NOW-6000}),NOW),null);assert.equal(freshFusionStart(mk('telemetry',{receivedAt:NOW+2}),NOW),null);assert.equal(freshFusionStart(mk('telemetry',{ageAtReceiptMs:6000}),NOW),null)});
test('accept FUS with no telemetry sats metadata',()=>{const f=mk('fusion',{satsLocked:undefined});assert.equal(freshFusionStart(f,NOW).fixSource,'fusion')});
test('GPS position revalidated at actual submit time',()=>{const fix=mk('telemetry');const start=freshFusionStart(fix,NOW);assert.equal(makeStraightLeg({start,target:[14.609,120.990],pinIndex:0,now:NOW,gps:fix}).originSource,'GPS');assert.throws(()=>makeStraightLeg({start,target:[14.609,120.990],pinIndex:0,now:NOW+6000,gps:fix}),/GPS position changed or expired/)});
test('GPS provenance cannot silently switch while planning',()=>{let f=mk('fusion');let start=freshFusionStart(f,NOW);let other=mk('telemetry');assert.throws(()=>makeStraightLeg({start,target:[14.609,120.990],pinIndex:0,now:NOW,gps:other}),/GPS position changed or expired/)});
test('manual map start remains independent of radio GPS',()=>{const p=makeStraightLeg({start:{source:'MANUAL',coords:[14.608,120.989]},target:[14.609,120.990],pinIndex:0,now:NOW,gps:null});assert.equal(p.originSource,'MANUAL')});
test('TF 60-second mission maximum remains unchanged',()=>assert.equal(MAX_LEG_S,60));
test('Field Map still uses original satellite validation and telemetry event',()=>{const s=fs.readFileSync(path.join(project,files[2]),'utf8');assert.match(s,/setTelemetryNavGps\(\{ source: 'telemetry', valid: true/);assert.match(s,/satsLocked: Number\(data\.satsLocked\)/);assert.match(s,/setTelemetryNavGps\(null\)/)});
test('Point A clearly labels fallback GPS as non-fused',()=>{const s=fs.readFileSync(path.join(project,files[1]),'utf8');assert.match(s,/Live rover GPS telemetry \(not fused\)/);assert.match(s,/Fresh GPS from live DATA telemetry/)});
test('reject missing expected code without writing anything',()=>{const broken=fs.mkdtempSync(path.join(os.tmpdir(),'eksplorador-gps-broken-'));for(const f of files){const to=path.join(broken,f);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(ROOT,'fixtures',f),to)}const d=path.join(broken,files[1]);fs.writeFileSync(d,fs.readFileSync(d,'utf8').replace('const gpsStatus =','const gpsStatusBroken ='));assert.throws(()=>apply(broken,false,()=>{}),/expected one anchor/);assert.equal(fs.readFileSync(path.join(broken,files[0]),'utf8'),old.get(files[0]));fs.rmSync(broken,{recursive:true,force:true})});
console.log(`\n${passed}/${passed} regression checks passed`);
fs.rmSync(project,{recursive:true,force:true});
