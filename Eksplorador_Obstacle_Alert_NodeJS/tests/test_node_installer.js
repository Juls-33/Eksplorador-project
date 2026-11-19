'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync}=require('node:child_process');
const PATCHER=path.join(__dirname,'..','apply_obstacle_alert.js');
const ROVER=`#include <Arduino.h>\n#include <LoRa.h>\nchar inLine[160];\nbool awaitingAck=false;\nuint32_t packetId=1;\nvoid serviceMissionForward() {}\nvoid processMegaLine(const char *s) {\n if (!strcmp(s, "SET_MODE:RX")) {}\n else if (!strncmp(s, "MISSION_STATUS:", 15)) {\n   Serial.print("[MEGA MISSION] ");\n   Serial.println(s + 15);\n }\n}\nvoid serviceTx() { int n=LoRa.parsePacket(); }\nvoid loop() { if (txMode) {\n      serviceTx();\n\n      if (!awaitingAck) { doTelemetry(); }\n} }\n`;
const RUST=`use tauri::Emitter;\nfn read_serial(text: String) {\n let trimmed = text.trim();\n if trimmed.is_empty() { return; }\n                                match encoder_telemetry::classify(trimmed) {\n_ => {}\n}\n}\n`;
const MAIN="import App from './App.jsx';\nimport React from 'react';\ncreateRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n";
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'eksplorador-js-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const src={
  'embedded/rover/rover.ino':ROVER,
  'embedded/mega/mega.ino':'// current proven Mega: do not change',
  'embedded/rx_board/receiver.ino':'// current receiver: do not change',
  'apps/desktop/src-tauri/src/lib.rs':RUST,
  'apps/desktop/src/main.jsx':MAIN,
 };
 for(const [name,content] of Object.entries(src)){ const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content); }
 return root;
}
function run(root,opts=[]){return spawnSync(process.execPath,[PATCHER,root,...opts],{encoding:'utf8'});}
function read(root,file){return fs.readFileSync(path.join(root,file),'utf8');}
function checksum(text){return crypto.createHash('sha256').update(text).digest('hex');}

test('dry run is non-destructive; install applies all layers; idempotent',t=>{
 const root=setup(t);
 const mega0=checksum(read(root,'embedded/mega/mega.ino'));
 const receiver0=checksum(read(root,'embedded/rx_board/receiver.ino'));
 const rover0=checksum(read(root,'embedded/rover/rover.ino'));
 let result=run(root,['--dry-run']);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/WOULD PATCH/);
 assert.equal(checksum(read(root,'embedded/rover/rover.ino')),rover0);
 result=run(root);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/Done/);
 assert.match(read(root,'embedded/rover/rover.ino'),/queueObstacleAlert\(s\)/);
 assert.match(read(root,'embedded/rover/rover.ino'),/serviceObstacleAlert\(\)/);
 assert.match(read(root,'apps/desktop/src-tauri/src/lib.rs'),/app_handle\.emit\("rover-obstacle", alert\)/);
 assert.match(read(root,'apps/desktop/src/main.jsx'),/RoverObstacleAlert/);
 assert.ok(fs.existsSync(path.join(root,'apps/desktop/src-tauri/src/obstacle_alert.rs')));
 assert.ok(fs.existsSync(path.join(root,'apps/desktop/src/components/RoverObstacleAlert.jsx')));
 assert.ok(fs.existsSync(path.join(root,'embedded/rover/rover.ino.before-obstacle-alert.bak')));
 assert.equal(checksum(read(root,'embedded/mega/mega.ino')),mega0);
 assert.equal(checksum(read(root,'embedded/rx_board/receiver.ino')),receiver0);
 const patchedRover=read(root,'embedded/rover/rover.ino');
 result=run(root);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/Already installed/);
 assert.equal(read(root,'embedded/rover/rover.ino'),patchedRover);
});

test('anchor drift aborts before any patch or backups are written',t=>{
 const root=setup(t);
 fs.writeFileSync(path.join(root,'apps/desktop/src-tauri/src/lib.rs'),'some different Rust source');
 const original=read(root,'embedded/rover/rover.ino');
 const result=run(root);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/expected exactly one anchor/);
 assert.equal(read(root,'embedded/rover/rover.ino'),original);
 assert.ok(!fs.existsSync(path.join(root,'embedded/rover/rover.ino.before-obstacle-alert.bak')));
});

test('multiple candidate rover versions force explicit --rover selection',t=>{
 const root=setup(t);
 const extra=path.join(root,'embedded','old','archived.ino');
 fs.mkdirSync(path.dirname(extra),{recursive:true});fs.writeFileSync(extra,ROVER);
 let result=run(root,['--dry-run']);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Expected one rover ESP32 sketch/);
 result=run(root,['--rover','embedded/rover/rover.ino','--dry-run']);
 assert.equal(result.status,0,result.stderr);
 assert.equal(read(root,'embedded/rover/rover.ino'),ROVER);
});

test('refuses to overwrite mismatched custom UI component',t=>{
 const root=setup(t);
 const component=path.join(root,'apps/desktop/src/components/RoverObstacleAlert.jsx');
 fs.mkdirSync(path.dirname(component),{recursive:true});fs.writeFileSync(component,'custom code');
 const original=read(root,'embedded/rover/rover.ino');
 const result=run(root);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/already exists with different contents/);
 assert.equal(read(root,'embedded/rover/rover.ino'),original);
});


test('real-world rover TX loop formatting variants patch without exact blank-line anchors',t=>{
 const root=setup(t);
 const roverPath=path.join(root,'embedded/rover/rover.ino');
 const variants=[
  'void loop() { if (txMode) {\\n      serviceTx();\\n      if (!awaitingAck) { doTelemetry(); }\\n} }',
  'void loop() {\\n    readMega();\\n    serviceMissionForward();\\n    if (loraReady) { if (txMode) {\\n      serviceTx(); } }\\n }',
  'void loop(){readGPS(); readMega(); serviceMissionForward(); if (loraReady && txMode) {\n serviceTx();\n}}',
 ];
 for (const variant of variants) {
   const original=ROVER.replace(/void loop\(\) \{[\s\S]*$/,variant.replace(/\\n/g,'\n'));
   fs.writeFileSync(roverPath,original);
   const result=run(root,['--dry-run','--rover','embedded/rover/rover.ino']);
   assert.equal(result.status,0,`dry run failed: ${result.stderr}\\n${variant}`);
   assert.equal(fs.readFileSync(roverPath,'utf8'),original,'dry run must not change file');
 }
});

test('works with rover loop on separate lines and never touches Mega or RX_BOARD',t=>{
 const root=setup(t);
 const roverPath=path.join(root,'embedded/rover/rover.ino');
 const modified=ROVER.replace(/void loop\(\) \{[\s\S]*$/,`void loop() {
  readGPS();
  readMega();
  serviceMissionForward();
  if (loraReady) {
    if (txMode) {
      serviceTx();
      if (!awaitingAck) doTelemetry();
    }
  }
}`);
 fs.writeFileSync(roverPath,modified);
 const result=run(root,['--rover','embedded/rover/rover.ino']);
 assert.equal(result.status,0,result.stderr);
 const patched=read(root,'embedded/rover/rover.ino');
 assert.match(patched,/if \(serviceObstacleAlert\(\)\) \{ delay\(1\); return; \}\s*serviceTx\(\);/);
 assert.equal(read(root,'embedded/mega/mega.ino'),'// current proven Mega: do not change');
 assert.equal(read(root,'embedded/rx_board/receiver.ino'),'// current receiver: do not change');
});
