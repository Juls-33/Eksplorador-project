import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWaypointMission,readHeadingReference,missionWaypointEvidence} from '../src/utils/waypointMission.js';
const points=[[14.609,120.989],[14.609445,120.989305]];
test('normal waypoint upload is compact, coordinate-only and independent of GPS or motor readiness',()=>{
 const plan=createWaypointMission(points);assert.equal(plan.protocol,'N1');assert.equal(plan.legs.length,2);
 assert.equal(plan.sequence,'N1,W104609000.300989000,W104609445.300989305');
 assert.equal(plan.tokens.some(t=>/^[FLR]/.test(t)),false);assert.equal(plan.initialHeading,null);
 const distant=createWaypointMission([[14.7,120.99],[14.8,121.0]]);assert.equal(distant.tokens.length,3);
});
test('invalid and genuinely oversized waypoint lists are rejected whole; no pin is silently omitted',()=>{
 for(const p of [[],null,[[NaN,120]],[[91,120]],[[14,181]],[[14,'120']]])assert.throws(()=>createWaypointMission(p));
 assert.equal(createWaypointMission(Array.from({length:10},()=>points[0])).legs.length,10);
 assert.throws(()=>createWaypointMission(Array.from({length:11},()=>points[0])),/11\/10 pins.*233\/226 ASCII bytes.*no pin was omitted/);
 assert.equal(createWaypointMission([[-90,-180],[90,180]]).legs.length,2);
});
test('optional operator heading is explicit and one-use setup expires instead of assuming GPS course',()=>{
 const plan=createWaypointMission(points,{initialHeading:90});assert.ok(plan.sequence.startsWith('N1,H90,W'));
 assert.ok(createWaypointMission(points,{initialHeading:359.9999}).sequence.startsWith('N1,H0,W'));
 for(const h of [-1,360,NaN,Infinity])assert.throws(()=>createWaypointMission(points,{initialHeading:h}));
 const storage={getItem:()=>JSON.stringify({heading:90,confirmedAt:1000})};
 assert.equal(readHeadingReference(storage,1100).heading,90);assert.equal(readHeadingReference(storage,301001),null);assert.equal(readHeadingReference(storage,999),null);
});
test('N1 status steps mean waypoint index, not payload-token index; STEP_DONE cannot verify arrival',()=>{
 const sequence=createWaypointMission(points,{initialHeading:90}).sequence;
 const deployment={sequence,status_history:[{state:'STEP_DONE',reason:'ENCODER_ESTIMATE',step:1},{state:'PIN_CHECKED',reason:'GPS_WITHIN_5M',step:2}]};
 const rows=missionWaypointEvidence(deployment);assert.equal(rows[0].evidence,'Waypoint arrival unverified');assert.equal(rows[1].evidence,'GPS verification reported');
 deployment.status_history.push({state:'COMPLETE',reason:'GPS_ROUTE_VERIFIED',step:2});assert.equal(missionWaypointEvidence(deployment)[0].evidence,'Waypoint arrival unverified');
});
