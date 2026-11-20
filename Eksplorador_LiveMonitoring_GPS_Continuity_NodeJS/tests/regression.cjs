'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {patchApp,main,MARKER,REL} = require('../apply_live_gps_fix.js');
const UTIL_FILE = path.join(__dirname, 'fixtures', 'roverPositionDisplay.js');
const HOOK_FILE = path.join(__dirname, 'fixtures', 'useRoverDisplayPosition.js');
const MAP_CONTENT = `export default function HeatmapMap({roverPositionStatus}) {
  const isLastKnown = roverPositionStatus === 'LAST_KNOWN';
  roverMarkerRef.current.setOpacity(isLastKnown ? 0.45 : 1);
}`;
const FIELD_CONTENT = `// EKSPLORADOR_GPS_DISPLAY_CONTINUITY_V1
 const roverDisplay = { position: [14.6, 120.9] };
 const mapRover = roverDisplay.position;
`;
const APP = `import React, { useState, useMemo, useEffect } from 'react';
import HeatmapMap from './components/HeatmapMap';
import { useLoRaConnection } from './hooks/useLoRaConnection';
const hasLiveGpsFix = d => d && d.satsLocked > 0 && d.lat !== 0 && d.lng !== 0;
function App() {
  const receiverStatus = useLoRaConnection();
  const [liveData, setLiveData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [batteryData, setBatteryData] = useState(null);
  const [soilReadings, setSoilReadings] = useState([]);
  const selectedHistoricalPos = null;
  const latestDbPos = null;
  const displayedHeatPoints = [];
  const displayScale = () => 1;
  const hasGpsFix =
    isConnected && hasLiveGpsFix(liveData);
  const soilOk = liveData && liveData.soilValid === 1;
  function handleData(data) {
    if(data.type === 'battery') { setBatteryData(data); return; }
    if(hasLiveGpsFix(data) && data.soilValid === 1) setSoilReadings(x => [...x,data]);
    setLiveData(data);
    setIsConnected(true);
  }
  return <div>
    <HeatmapMap
      center={
        selectedHistoricalPos ||
        (
          hasGpsFix
            ? [liveData.lat, liveData.lng]
            : latestDbPos || [14.6095, 120.9890]
        )
      }
      heatPoints={displayedHeatPoints}
      valueToIntensity={displayScale}
      roverPos={
        !selectedHistoricalPos && hasGpsFix
          ? [liveData.lat, liveData.lng]
          : null
      }
      gpsWarning={
        !hasGpsFix
          ? !isConnected
            ? 'Waiting for rover telemetry and GPS position.'
            : Number(liveData?.satsLocked) === 0
              ? '0 satellites locked. Live location is unavailable.'
              : 'Waiting for valid GPS coordinates.'
          : null
      }
    />
    <span>{soilOk?'Soil OK':'No soil'}</span>
  </div>;
}
export default App;
`;
function write(root, rel, content) {const dest=path.join(root,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);}
function read(root,rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function fixture(opts={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eksplorador-live-gps-'));
  write(root,'apps/desktop/src/App.jsx',opts.app??APP);
  write(root,'apps/desktop/src/hooks/useRoverDisplayPosition.js',fs.readFileSync(HOOK_FILE,'utf8'));
  write(root,'apps/desktop/src/utils/roverPositionDisplay.js',fs.readFileSync(UTIL_FILE,'utf8'));
  write(root,'apps/desktop/src/components/HeatmapMap.jsx',MAP_CONTENT);
  write(root,'apps/desktop/src/views/FieldMapView.jsx',FIELD_CONTENT);
  write(root,'apps/desktop/src/services/db.js','// original DB and soil sampling, unchanged\n');
  write(root,'embedded/mega/WORKING.ino','// working hardware firmware: do not edit\n');
  write(root,'embedded/rover/WORKING.ino','// working rover firmware: do not edit\n');
  return root;
}
function cleanup(root){fs.rmSync(root,{recursive:true,force:true});}

// 1. User-experienced behavior: no fix -> held visual marker, not live fix.
test('1 live GPS marker uses display-only position while original GPS validity stays unchanged',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/roverPos=\{!selectedHistoricalPos \? liveMapDisplay\.position : null\}/);
 assert.match(out,/roverPositionStatus=\{liveMapDisplay\.mode\}/);
 assert.match(out,/const hasGpsFix =\s*isConnected && hasLiveGpsFix\(liveData\);/);
});
test('2 zero satellite event keeps existing No Fix classification and warning fallback',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/Number\(liveData\?\.satsLocked\) === 0/);
 assert.match(out,/0 satellites locked\. Live location is unavailable/);
 assert.match(out,/last known position/);
});
test('3 cached position cannot be re-used for saved soil readings',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/hasLiveGpsFix\(data\) && data\.soilValid === 1/);
 assert.match(out,/setSoilReadings\(x => \[\.\.\.x,data\]\)/);
 assert.doesNotMatch(out,/setSoilReadings\([^)]*liveMapDisplay/);
 assert.doesNotMatch(out,/setLiveData\(liveMapDisplay/);
});
test('4 receiver connection combines packet freshness and actual receiver status',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/isConnected && receiverStatus\.connected && !receiverStatus\.connectionError/);
});
test('5 historical selection continues to override map center and hide active rover marker',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/center=\{selectedHistoricalPos \|\| liveMapDisplay\.position/);
 assert.match(out,/roverPos=\{!selectedHistoricalPos \? liveMapDisplay\.position : null\}/);
});
test('6 regular UI rerenders cannot refresh fix age through new coordinate arrays',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/const liveMapGps = useMemo\(/);
 assert.match(out,/\[hasGpsFix, liveData\?\.seq, liveData\?\.lat, liveData\?\.lng\]/);
 assert.doesNotMatch(out,/useRoverDisplayPosition\(\s*\[liveData\.lat/);
});
test('7 GPS continuity is explicitly not dead reckoning',()=>{
 const out=patchApp(APP).output;
 assert.match(out,/not live GPS or dead reckoning/);
 assert.doesNotMatch(out,/FORWARD_MPS|driveMotor|motorPWM|setRoverPos/);
});
test('8 patch source is well formed (and JSX syntax is checked when TypeScript is available)',()=>{
 let ts = null;
 try { ts = require('typescript'); } catch {}
 if (!ts) { try {ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');} catch {} }
 const src=patchApp(APP).output;
 assert.ok(src.includes('<HeatmapMap'), 'missing target map');
 assert.ok(src.includes('liveMapDisplay.mode'), 'missing map status');
 if (ts) {
  const parsed=ts.createSourceFile('App.jsx',src,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JSX);
  assert.equal(parsed.parseDiagnostics.length,0,parsed.parseDiagnostics.map(d=>d.messageText).join('\n'));
 }
});
test('9 a valid source patch is deterministic and idempotent',()=>{
 const once=patchApp(APP);
 assert.equal(once.already,false);
 assert.equal(patchApp(once.output).already,true);
 assert.equal(patchApp(once.output).output,once.output);
});
test('10 multiline / irregular indentation still matches known App.jsx anchors',()=>{
 const spaced=APP.replace('      center={','      center   = {')
  .replace('      roverPos={','      roverPos = {')
  .replace('      gpsWarning={','      gpsWarning = {')
  .replace("import { useLoRaConnection } from './hooks/useLoRaConnection';", "import {\n  useLoRaConnection\n} from './hooks/useLoRaConnection';");
 assert.equal(patchApp(spaced).already,false);
});
test('11 Windows CRLF source stays CRLF',()=>{
 const src=APP.replace(/\n/g,'\r\n');
 const out=patchApp(src).output;
 assert.ok(out.includes('\r\n'));
 assert.equal((out.match(/(?<!\r)\n/g)||[]).length,0);
});
test('12 incorrect App.jsx source aborts before writing',()=>{
 const root=fixture({app:APP.replace('hasGpsFix\n          ?','broken_gps\n          ?')});
 try {
  const prev=read(root,REL);
  assert.throws(()=>main(root,{log:()=>{}}),/source anchor/);
  assert.equal(read(root,REL),prev);
 }finally{cleanup(root);}
});
test('13 missing installed map helper fails closed',()=>{
 const root=fixture();
 try{
  fs.rmSync(path.join(root,'apps/desktop/src/hooks/useRoverDisplayPosition.js'));
  const original=read(root,REL);
  assert.throws(()=>main(root,{log:()=>{}}),/Missing previously installed/);
  assert.equal(read(root,REL),original);
 }finally{cleanup(root);}
});
test('14 incompatible existing map code fails closed',()=>{
 const root=fixture();
 try{
  write(root,'apps/desktop/src/components/HeatmapMap.jsx','// old unpatched map\n');
  assert.throws(()=>main(root,{log:()=>{}}),/prerequisite incompatible/);
  assert.equal(read(root,REL),APP);
 }finally{cleanup(root);}
});
test('15 dry-run makes no file changes and creates no new backup',()=>{
 const root=fixture();
 try{
  const app=read(root,REL);
  let output='';main(root,{dryRun:true,log:s=>output+=s+'\n'});
  assert.match(output,/WOULD PATCH/);
  assert.match(output,/Only App\.jsx would be changed/);
  assert.equal(read(root,REL),app);
 }finally{cleanup(root);}
});
test('16 apply patches exactly App.jsx; firmware, DB and FieldMap unmodified',()=>{
 const root=fixture();
 try{
  const originals=['embedded/mega/WORKING.ino','embedded/rover/WORKING.ino','apps/desktop/src/services/db.js','apps/desktop/src/views/FieldMapView.jsx','apps/desktop/src/components/HeatmapMap.jsx','apps/desktop/src/hooks/useRoverDisplayPosition.js'].map(rel=>[rel,read(root,rel)]);
  let output='';main(root,{log:s=>output+=s+'\n'});
  assert.match(output,/Done/);
  assert.match(read(root,REL),/EKSPLORADOR_LIVE_MONITORING_GPS_CONTINUITY_V1/);
  for(const [rel,original] of originals)assert.equal(read(root,rel),original,rel);
 }finally{cleanup(root);}
});
test('17 second install recognizes installed patch and leaves source unchanged',()=>{
 const root=fixture();
 try{
  main(root,{log:()=>{}});
  const patched=read(root,REL);
  let msg='';main(root,{log:s=>msg+=s+'\n'});
  assert.equal(read(root,REL),patched);
  assert.match(msg,/ALREADY PATCHED/);
 }finally{cleanup(root);}
});
test('18 partial previously patched App.jsx is not overwritten',()=>{
 const root=fixture({app:APP+`\n// ${MARKER}\n`});
 try {
  assert.throws(()=>main(root,{log:()=>{}}),/incomplete or conflicting/);
  assert.equal(read(root,REL),APP+`\n// ${MARKER}\n`);
 }finally{cleanup(root);}
});
test('19 original hook handles fixes and >30-second expiry independently of raw GPS data',async()=>{
 const raw=fs.readFileSync(UTIL_FILE,'utf8');
 const helper=await import('data:text/javascript;base64,'+Buffer.from(raw).toString('base64'));
 const last={position:[14.599,120.999],receivedAt:1000};
 for(const t of [1000,5000,25000,31000]){
  const res=helper.resolveLastKnownGpsDisplay(last,t,true);
  assert.equal(res.mode,'LAST_KNOWN');
  assert.deepEqual(res.position,last.position);
 }
 assert.equal(helper.resolveLastKnownGpsDisplay(last,31001,true).mode,'UNAVAILABLE');
 assert.equal(helper.resolveLastKnownGpsDisplay(last,2000,false).mode,'UNAVAILABLE');
 assert.equal(helper.resolveLastKnownGpsDisplay({position:[0,0],receivedAt:1000},2000,true).mode,'UNAVAILABLE');
});
test('20 missing GPS after reconnect does not reuse old session if receiver dropped',async()=>{
 const helper=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(UTIL_FILE,'utf8')).toString('base64'));
 const last={position:[14.6,120.99],receivedAt:1000};
 assert.equal(helper.resolveLastKnownGpsDisplay(last,1001,false).position,null);
 // Hook implementation clears lastFixRef on disconnection; verify this behavior retained.
 const source=fs.readFileSync(HOOK_FILE,'utf8');
 assert.match(source,/if \(!receiverConnected\) \{\s*lastFixRef\.current = null;/);
});
test('21 older GPS-fix, speed-calibration and obstacle alert are not altered by App.jsx patch',()=>{
 const original=APP+`\n// existing unrelated behavior: FORWARD_MPS = 2.9 / 22; obstacle_alert();\n`;
 const patched=patchApp(original).output;
 assert.match(patched,/FORWARD_MPS = 2\.9 \/ 22/);
 assert.match(patched,/obstacle_alert\(\)/);
});
