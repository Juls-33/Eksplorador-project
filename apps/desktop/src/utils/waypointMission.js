import { validCoordinate, waypointToken } from './missionPlanning.js';

export const WAYPOINT_PROTOCOL = 'N1';
export const MAX_WAYPOINTS = 10;
export const MAX_WAYPOINT_BYTES = 226;
export const HEADING_REFERENCE_KEY = 'eksplorador-next-heading';
export const formatFirmwareVersion=code=>Number.isInteger(code)&&code>=0
  ? `${Math.floor(code/10000)}.${Math.floor(code/100)%100}.${code%100}`:'Unreported';

export function readHeadingReference(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const value = JSON.parse(storage?.getItem(HEADING_REFERENCE_KEY) || 'null');
    return value && Number.isFinite(value.heading) && value.heading >= 0 && value.heading < 360
      && Number.isFinite(value.confirmedAt) && now >= value.confirmedAt && now - value.confirmedAt <= 300000 ? value : null;
  } catch { return null; }
}

// Upload is deliberately independent of GPS, firmware readiness and motor
// calibration. The onboard controller enforces those conditions before output.
export function createWaypointMission(waypoints, {initialHeading = null, now = Date.now()} = {}) {
  if (!Array.isArray(waypoints) || !waypoints.length || !waypoints.every(validCoordinate)) throw new Error('Select valid waypoint coordinates in the intended order.');
  if (initialHeading !== null && (!Number.isFinite(initialHeading) || initialHeading < 0 || initialHeading >= 360)) throw new Error('Invalid optional true-north heading reference.');
  const tokens=['N1'];
  if (initialHeading !== null) tokens.push(`H${Number(initialHeading.toFixed(3))%360}`);
  const legs=waypoints.map((coordinates,index)=>{
    const token=waypointToken(coordinates);tokens.push(token);
    return {pin:index+1, coordinates:[...coordinates], checkpointStep:index+1, token};
  });
  const sequence=tokens.join(',');
  if (waypoints.length > MAX_WAYPOINTS || sequence.length > MAX_WAYPOINT_BYTES) {
    throw new Error(`Waypoint list exceeds capacity: ${waypoints.length}/10 pins, ${sequence.length}/226 ASCII bytes. Shorten the waypoint list; no pin was omitted.`);
  }
  return {protocol:'N1',firmware:'A3.1-N1',createdAt:now,sequence,tokens,legs,initialHeading,
    navigationMode:'ONBOARD_FEEDBACK',limitations:'Upload stages targets only. Powered navigation requires measured calibration, valid positioning/heading and deliberate RC authorization. Automatic probe deployment is disabled.'};
}

export function missionWaypointEvidence(deployment) {
  if(!deployment?.sequence?.startsWith('N1,'))return null;
  const reports=deployment.status_history?.length?deployment.status_history:deployment.mega_status?[deployment.mega_status]:[];
  return deployment.sequence.split(',').filter(token=>token.startsWith('W')).map((token,index)=>({token,pin:index+1,step:index+1,
    evidence:reports.some(s=>s.step===index+1&&s.state==='PIN_CHECKED'&&s.reason==='GPS_WITHIN_5M')?'GPS verification reported':'Waypoint arrival unverified'}));
}
