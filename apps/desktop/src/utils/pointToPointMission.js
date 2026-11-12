import { calculateBearing, calculateDistance } from './geo.js';

// A3.1 Mega accepts a supervised, timed one-leg TF command, max 2 seconds.
// The map estimates direction/distance; this is NOT GPS waypoint tracking.
export const FORWARD_MPS = 0.25; // measured field estimate; ground speed varies
export const MIN_LEG_S = 0.100;
export const MAX_LEG_S = 2.000;
export const GPS_FRESH_MS = 5000; // backend FUS planning_gps freshness limit

export function validPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180 &&
    !(point[0] === 0 && point[1] === 0);
}

export function freshFusionStart(fix, now = Date.now()) {
  if (!fix || fix.source !== 'fusion' || fix.valid !== true || !validPoint(fix.position) ||
      !Number.isFinite(fix.receivedAt) || !Number.isFinite(fix.ageAtReceiptMs) ||
      fix.receivedAt > now || fix.ageAtReceiptMs < 0 ||
      now - fix.receivedAt + fix.ageAtReceiptMs > GPS_FRESH_MS) return null;
  return { coords: [...fix.position], source: 'GPS', capturedAt: fix.receivedAt };
}

export function operatorMapStart(coords) {
  if (!validPoint(coords)) return null;
  return { coords: [...coords], source: 'MANUAL' };
}

export function makeStraightLeg({ start, target, pinIndex, now = Date.now(), gps = null }) {
  if (!validPoint(target) || !Number.isInteger(pinIndex) || pinIndex < 0) {
    throw new Error('Choose a valid destination pin (Point B).');
  }
  if (!start || !validPoint(start.coords) || !['GPS', 'MANUAL'].includes(start.source)) {
    throw new Error('Use a fresh GPS location or select Point A on the map.');
  }
  if (start.source === 'GPS') {
    const current = freshFusionStart(gps, now);
    if (!current || current.capturedAt !== start.capturedAt ||
        current.coords.some((value, i) => value !== start.coords[i])) {
      throw new Error('GPS position changed or expired. Confirm fresh GPS again.');
    }
  }
  const distanceM = calculateDistance(start.coords, target);
  const bearing = calculateBearing(start.coords, target);
  if (!Number.isFinite(distanceM) || distanceM < FORWARD_MPS * MIN_LEG_S) {
    throw new Error('Point B is too close for a bounded timed command. Inspect arrival or drive manually.');
  }
  const estimatedTotalS = distanceM / FORWARD_MPS;
  const durationS = Math.floor(Math.min(MAX_LEG_S, estimatedTotalS) * 1000) / 1000;
  if (durationS < MIN_LEG_S) throw new Error('The forward command would be shorter than 0.100 seconds.');
  const sequence = `TF${durationS.toFixed(3)}`;
  return {
    protocol: 'A31_TIMED', firmware: 'A3.1', sequence,
    createdAt: now, origin: [...start.coords], originSource: start.source,
    destination: [...target], destinationPin: pinIndex + 1,
    // These fields preserve compatibility with the rollback experiment recorder.
    legs: [{ pin: pinIndex + 1, coordinates: [...target], distanceM, bearingDegrees: bearing }],
    distanceM, bearing, estimatedTotalS, durationS,
    estimatedLegM: durationS * FORWARD_MPS,
    partial: durationS + 0.0001 < estimatedTotalS,
    limitations: 'Forward timed travel only; manually aligned heading, no onboard coordinate targeting or automatic arrival confirmation.'
  };
}
