import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
const root=new URL('../../../embedded/',import.meta.url);
const source=p=>readFileSync(new URL(p,root),'utf8');
const prefix='1 Final Microcontroller Firmwares (unuploaded)/';
test('both relay hops use the same numeric-reason status parser and N1 targets are explicitly versioned',()=>{
 const shared=source('shared/WaypointProtocol.h');
 assert.ok(shared.includes('%33[A-Z0-9_]'));
 for(const p of ['rover/Rover_A3_0/Rover_A3_0.ino','desktop/Receiver_A3_0/Receiver_A3_0.ino'])assert.ok(source(prefix+p).includes('WaypointProtocol::status('));
 assert.ok(source(prefix+'desktop/Receiver_A3_0/Receiver_A3_0.ino').includes('WaypointProtocol::statusJson('));
 assert.ok(source(prefix+'rover/Rover_A3_0/Rover_A3_0.ino').includes('WaypointProtocol::parse(frame.sequence,targets)'));
});
test('autonomous execution uses the tested controller and validated persisted measurements; manual calibration is not invented',()=>{
 const main=source(prefix+'mega/Mega_A3_0/Mega_A3_0.ino'),wrapper=source(prefix+'mega/Mega_A3_0/NavigationMega.h');
 assert.ok(main.includes('#include "NavigationMega.h"'));
 assert.ok(wrapper.includes('a31Navigation.tick(a31Input())'));
 assert.ok(wrapper.includes('NavigationCalibration::valid(check)'));
 assert.ok(wrapper.includes('a31Calibration.ready()'));
 assert.ok(wrapper.includes('a31Navigation.start(a31Input())'));
 assert.ok(wrapper.includes('stopActuator()'));
 assert.ok(main.includes('processManualDrive(throttle, steer)'));
 assert.ok(main.includes('processManualActuator(actuator)'));
 assert.ok(main.includes('updateTiltSafety('));
 const core=source('shared/WaypointNavigation.h');
 assert.ok(core.includes('leftMetersPerRev=0, rightMetersPerRev=0, trackWidth=0'));
 assert.ok(core.includes('s.now-gpsAt>5000 || gpsTravel>1.5f'));
});
test('the working nineteen-field DATA protocol remains present alongside additive NI1, NG1, NT1 and NC1 messages',()=>{
 const rover=source(prefix+'rover/Rover_A3_0/Rover_A3_0.ino');
 assert.ok(rover.includes('// 19-field payload; compatible with existing schema.'));
 for(const prefix of ['NI1:','NG1:','NT1:','NC1:'])assert.ok(rover.includes(prefix));
});
