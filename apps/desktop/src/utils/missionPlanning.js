import { calculateDistance } from './geo.js';

export const MAX_SEQUENCE_BYTES = 226;
export const MAX_TOKENS = 40;
export const MAX_GPS_AGE_MS = 5000;
export const validCoordinate = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// A received coordinate alone cannot establish fix validity or its source age.
// The working 19-field DATA protocol has no GPS validity/age. Only FUS
// supplies explicitly qualified GPS; never substitute satellite count/course.
export function gpsObservation(data, receivedAt = Date.now()) {
  return { source:'fusion', position:[data.lat, data.lng],
    valid:data.type === 'fusion' && Number.isInteger(data.fusionSeq) && data.fusionSeq >= 0 && data.fusionSeq <= 0xffffffff
      && data.positionSource === 'GPS_ONLY' && (data.gpsValid === true || data.gpsValid === 1),
    ageAtReceiptMs:data.gpsAgeMs, receivedAt, sequence:data.fusionSeq };
}

export function requireFreshGps(gps, now = Date.now()) {
  if (!gps || !validCoordinate(gps.position) || gps.valid !== true
    || !Number.isSafeInteger(gps.receivedAt) || !Number.isSafeInteger(gps.ageAtReceiptMs)
    || gps.ageAtReceiptMs < 0 || now < gps.receivedAt
    || gps.ageAtReceiptMs + now - gps.receivedAt > MAX_GPS_AGE_MS) {
    throw new Error('Fresh valid FUS GPS required (gpsValid, gpsAgeMs and fusionSeq); DATA coordinates alone cannot qualify.');
  }
  return gps.position;
}

export function waypointToken(position) {
  if (!validCoordinate(position)) throw new Error('Invalid waypoint coordinates.');
  return `W${String(Math.round((position[0] + 90) * 1e6)).padStart(2,'0')}.${Math.round((position[1] + 180) * 1e6)}`;
}

export function validateSequence(sequence) {
  if (typeof sequence !== 'string' || !sequence || !/^[FLRW0-9.,]+$/.test(sequence)) {
    throw new Error('Invalid A3.0 ASCII sequence.');
  }
  if (sequence.length > MAX_SEQUENCE_BYTES) throw new Error('Route exceeds 226 ASCII bytes; reduce the route. Nothing was truncated.');
  const tokens = sequence.split(',');
  if (tokens.length > MAX_TOKENS) throw new Error('Route exceeds 40 tokens; reduce the route. Nothing was truncated.');
  for (const token of tokens) {
    if (token.length > 23) throw new Error('A3.0 Mega tokens must be at most 23 ASCII bytes.');
    if (token[0] === 'W') {
      const match = /^W(\d{1,9})\.(\d{1,9})$/.exec(token);
      if (!match || token.length < 5 || Number(match[1]) > 180000000 || Number(match[2]) > 360000000) {
        throw new Error('Invalid encoded GPS checkpoint. The period must separate two integers.');
      }
    } else {
      const match = /^([FLR])(\d+(?:\.\d{1,3})?)$/.exec(token);
      const value = match && Number(match[2]);
      if (!match || value <= 0 || value > (match[1] === 'F' ? 1.5 : 90)) {
        throw new Error('Movement must be positive: F ≤ 1.5 meters; L/R ≤ 90 degrees.');
      }
    }
  }
  if (!tokens.some(t => t[0] === 'W') || tokens.at(-1)[0] !== 'W') {
    throw new Error('Each route must end at an absolute GPS checkpoint.');
  }
  return tokens;
}

function bearing(from, to) {
  const rad = d => d * Math.PI / 180;
  const a = rad(from[0]), b = rad(to[0]), delta = rad(to[1] - from[1]);
  return (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b)
    - Math.sin(a) * Math.cos(b) * Math.cos(delta)) * 180 / Math.PI + 360) % 360;
}

// Count the ENTIRE route without building thousands of F tokens for a distant
// map pin. Missing origin/heading gives a labelled lower bound, never a payload.
export function estimateRelativeMission({waypoints, origin = null, heading = null}) {
  if (!Array.isArray(waypoints) || !waypoints.length || !waypoints.every(validCoordinate)) throw new Error('Select valid waypoint pins.');
  const exact = validCoordinate(origin) && Number.isFinite(heading) && heading >= 0 && heading < 360;
  let tokens = [], tokenCount = 0, tokenBytes = 0, forwardSegments = 0, turnSegments = 0;
  const legs = [];
  let position = validCoordinate(origin) ? origin : null;
  let currentHeading = Number.isFinite(heading) && heading >= 0 && heading < 360 ? heading : null;
  const pushGroup = (token, count = 1) => {
    tokenCount += count; tokenBytes += token.length * count;
    if (tokens && tokenCount <= MAX_TOKENS) for (let i = 0; i < count; i++) tokens.push(token);
    else tokens = null;
  };
  const append = (action, amount, max) => {
    const units = Math.round(amount * 1000), maximum = max * 1000;
    const full = Math.floor(units / maximum), rest = units % maximum;
    if (full) pushGroup(`${action}${max}`, full);
    if (rest) pushGroup(`${action}${rest / 1000}`);
    const count = full + (rest ? 1 : 0);
    if (action === 'F') forwardSegments += count; else turnSegments += count;
  };
  waypoints.forEach((point, index) => {
    const distanceM = position ? calculateDistance(position, point) : null;
    if (position && !Number.isFinite(distanceM)) throw new Error('Cannot calculate a finite route distance for these coordinates.');
    const targetBearing = position && distanceM >= 0.0005 ? bearing(position, point) : currentHeading;
    const turnDegrees = targetBearing !== null && currentHeading !== null ? ((targetBearing - currentHeading + 540) % 360) - 180 : null;
    if (turnDegrees !== null) append(turnDegrees < 0 ? 'L' : 'R', Math.abs(turnDegrees), 90);
    if (distanceM !== null) append('F', distanceM, 1.5);
    const checkpoint = waypointToken(point);
    pushGroup(checkpoint);
    legs.push({ pin:index + 1, coordinates:[...point], encodedCoordinates:checkpoint.slice(1).split('.').map(Number),
      distanceM, bearingDegrees:targetBearing, turnDegrees, checkpointStep:tokenCount });
    currentHeading = turnDegrees !== null ? (currentHeading + Math.round(turnDegrees * 1000) / 1000 + 360) % 360 : targetBearing;
    position = point;
  });
  const byteCount = tokenBytes + tokenCount - 1;
  const withinLimits = tokenCount <= MAX_TOKENS && byteCount <= MAX_SEQUENCE_BYTES;
  return {exact, withinLimits, tokenCount, byteCount, forwardSegments, turnSegments, waypointCount:legs.length,
    tokens:exact && withinLimits ? tokens : null, sequence:exact && withinLimits ? tokens.join(',') : null, legs};
}

export function routeCapacityError(estimate) {
  return `Route capacity exceeded: ${estimate.exact ? '' : 'at least '}${estimate.tokenCount}/40 tokens and ${estimate.byteCount}/226 ASCII bytes (${estimate.forwardSegments} forward segments, ${estimate.turnSegments} turn segments, ${estimate.waypointCount} W checkpoints). Reduce the route. Nothing was truncated or omitted.`;
}

export function missionPrerequisites({gps, heading, headingConfirmed, calibrationConfirmed, firmwareConfirmed, radio = {}, route, now = Date.now()}) {
  let freshGps = false;
  try { requireFreshGps(gps, now); freshGps = true; } catch { /* independent prerequisite */ }
  return [
    {key:'gps', label:'Fresh valid GPS', ready:freshGps, detail:freshGps ? `FUS sequence ${gps.sequence}; explicitly valid GPS` : 'Waiting for fresh FUS gpsValid, gpsAgeMs, fusionSeq and coordinates.'},
    {key:'heading', label:'Confirmed initial true-north heading', ready:headingConfirmed === true && Number.isFinite(heading) && heading >= 0 && heading < 360,
      detail:'Enter the stationary rover’s compass heading and confirm it. GPS course is not its initial compass heading.'},
    {key:'calibration', label:'Firmware calibration confirmed', ready:calibrationConfirmed === true, detail:'Confirm measured distance/turn constants in the flashed Mega firmware. Receipt does not calibrate it.'},
    {key:'route', label:'Route generated within limits', ready:route?.exact === true && route.withinLimits === true,
      detail:route ? `${route.exact ? '' : 'At least '}${route.tokenCount}/40 tokens; ${route.byteCount}/226 ASCII bytes; ${route.waypointCount} checkpoints.` : 'Need waypoint coordinates, a planning origin and a numeric heading to generate the complete route.'},
    {key:'radio', label:'Correct LoRa communication mode', ready:radio.connected === true && !radio.connectionError && radio.mode === 'RX' && radio.protocol_v2 === true,
      detail:'Before opening the assistant: desktop USB connected, RX confirmed and Mission V2 detected. The assistant prepares desktop TX; confirm rover RX on CH8 for upload.'},
    {key:'firmware', label:'Compatible A3.0 firmware', ready:firmwareConfirmed === true, detail:'Operator confirmation for all three boards. A V2 banner does not identify A3.0 firmware.'},
  ];
}

// Freeze the initial GPS and confirmed heading once. Subsequent legs start at
// planned checkpoints, not presumed actual arrivals. Firmware must verify W.
export function createRelativeMission({ waypoints, gps, heading, headingConfirmed, calibrationConfirmed, firmwareConfirmed = false, now = Date.now() }) {
  const origin = requireFreshGps(gps, now);
  if (!Number.isFinite(heading) || heading < 0 || heading >= 360 || headingConfirmed !== true) {
    throw new Error('Operator must confirm an initial compass heading [0, 360) relative to true north.');
  }
  if (calibrationConfirmed !== true) throw new Error('Confirm encoder distance and turn calibration before deployment.');
  const estimate = estimateRelativeMission({waypoints, origin, heading});
  if (!estimate.withinLimits) throw new Error(routeCapacityError(estimate));
  const {sequence, tokens, legs} = estimate;
  validateSequence(sequence);
  // JSON copy prevents telemetry and editable pins from mutating the snapshot.
  return JSON.parse(JSON.stringify({ firmware:'A3.0', createdAt:now, gps, origin, initialHeading:heading,
    headingConfirmed:true, calibrationConfirmed:true, firmwareConfirmed, sequence, tokens, legs,
    limitations:'Estimated relative route. W requires GPS verification. No corrected continuous dead reckoning, obstacle bypass, or automatic soil sampling.' }));
}

export function compareWaypointGps(expected, gps, now, toleranceM) {
  if (!Number.isFinite(toleranceM) || toleranceM <= 0) throw new Error('Invalid comparison tolerance.');
  try {
    const actual = requireFreshGps(gps, now);
    const distanceM = calculateDistance(expected, actual);
    return { result:distanceM <= toleranceM ? 'WITHIN_COMPARISON_RADIUS' : 'OUTSIDE_COMPARISON_RADIUS', distanceM };
  } catch { return { result:'GPS_UNVERIFIED', distanceM:null }; }
}
