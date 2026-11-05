import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { gpsObservation, requireFreshGps } from '../src/utils/missionPlanning.js';
import {createWaypointMission} from '../src/utils/waypointMission.js';

const origin = [14.609,120.989];
const point = (n,e) => [origin[0]+n/111195,origin[1]+e/(111195*Math.cos(origin[0]*Math.PI/180))];
const nativeRoot = fileURLToPath(new URL('../src-tauri/',import.meta.url));
const crc32 = value => {
  let crc = 0xffffffff;
  for (const c of value) {
    crc ^= c.charCodeAt(0);
    for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).toUpperCase().padStart(8,'0');
};
test('two, three and four pin frontend plans pass the native V2 validator with unchanged bytes and standard CRC', () => {
  const fusion=JSON.parse(readFileSync(new URL('./fixtures/a30-receiver.jsonl',import.meta.url),'utf8').split(/\r?\n/)[3]);
  for (const waypoints of [[point(1,0),point(1,1)],[point(2,0),point(2,2),point(0,2)],
    [point(2,0),point(2,2),point(0,2),point(0,0)]]) {
    const plan = createWaypointMission(waypoints);
    const input = {sequence:plan.sequence}; // No GPS, heading or calibration prerequisite for transport.
    const result = spawnSync('cargo',['run','--offline','--quiet','--example','validate_mission'],
      {cwd:nativeRoot,input:JSON.stringify(input),encoding:'utf8',timeout:180000,windowsHide:true});
    assert.equal(result.status,0,result.error?.message ?? result.stderr);
    assert.equal(result.stdout.trim(),`M2:0000000000000001:${crc32(plan.sequence)}:${plan.sequence}`);
  }
});

test('actual receiver FUS replay qualifies GPS with invalid ENC while DATA, duplicate, older and stale fixes cannot qualify planning',()=>{
  const result=spawnSync('cargo',['run','--offline','--quiet','--example','replay_telemetry','--',
    fileURLToPath(new URL('./fixtures/a30-receiver.jsonl',import.meta.url))],{cwd:nativeRoot,encoding:'utf8',timeout:180000,windowsHide:true});
  assert.equal(result.status,0,result.error?.message??result.stderr);
  const frames=result.stdout.trim().split(/\r?\n/).map(JSON.parse);
  const data=frames.flatMap(f=>f.events).find(e=>e.event==='sensor-data').payload;
  assert.equal(data.gpsValid,undefined);assert.equal(data.gpsAgeMs,undefined);
  assert.throws(()=>requireFreshGps(gpsObservation(data,1000),1000),/FUS GPS/);
  const packets=frames.flatMap(f=>f.events).filter(e=>e.event==='fusion-data').map(e=>e.payload);
  assert.deepEqual(packets.map(p=>p.fusionSeq),[912,913,914]);
  assert.equal(packets[0].encoderValid,0);
  assert.deepEqual(requireFreshGps(gpsObservation(packets[0],packets[0].receivedAtMs),packets[0].receivedAtMs),origin);
  for(const packet of packets.slice(1)) assert.throws(()=>requireFreshGps(gpsObservation(packet,packet.receivedAtMs),packet.receivedAtMs));
});
