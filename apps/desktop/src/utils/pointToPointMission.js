import { calculateBearing, calculateDistance } from './geo.js';

// EKSPLORADOR_GPS_MISSION_FIX_V1

// A3.1 Mega accepts one supervised timed TF command, max 300 seconds (5 minutes).
// The map estimates direction/distance; this is NOT GPS waypoint tracking.
export const FORWARD_MPS = 0.25; // measured field estimate; ground speed varies
export const MIN_LEG_S = 0.100;
export const MAX_LEG_S = 300.000;
export const GPS_FRESH_MS = 5000; // backend FUS planning_gps freshness limit

export function validPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180 &&
    !(point[0] === 0 && point[1] === 0);
}

// Kept under its existing exported name for callers. Only satellite-confirmed
// DATA telemetry may be used if a fresh FUS fix is unavailable. No cached/stale GPS.
export function freshFusionStart(fix, now = Date.now()) {
  if (!fix || !['fusion', 'telemetry'].includes(fix.source) || fix.valid !== true ||
      !validPoint(fix.position) || !Number.isFinite(fix.receivedAt) ||
      !Number.isFinite(fix.ageAtReceiptMs) || fix.receivedAt > now ||
      fix.ageAtReceiptMs < 0 || now - fix.receivedAt + fix.ageAtReceiptMs > GPS_FRESH_MS ||
      (fix.source === 'telemetry' && (!Number.isInteger(fix.satsLocked) || fix.satsLocked < 1))) {
    return null;
  }
  return { coords: [...fix.position], source: 'GPS', capturedAt: fix.receivedAt,
    fixSource: fix.source };
}

// Prefer authoritative FUS; otherwise reuse the same fresh GPS that drives
// Field Map's rover pin, explicitly marked 'telemetry' rather than 'fusion'.
export function choosePlanningGps(fus, telemetry, now = Date.now()) {
  if (fus?.source === 'fusion' && freshFusionStart(fus, now)) return fus;
  if (telemetry?.source === 'telemetry' && freshFusionStart(telemetry, now)) return telemetry;
  return fus ?? null;
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
        current.fixSource !== start.fixSource ||
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
  // Never silently cap the distance: Point B must remain the planned destination.
  if (!Number.isFinite(estimatedTotalS) || estimatedTotalS > MAX_LEG_S + 1e-9) {
    throw new Error(
      `Point B is ${distanceM.toFixed(2)} m away (${estimatedTotalS.toFixed(3)} s estimated). ` +
      `A single forward leg supports at most ${MAX_LEG_S.toFixed(3)} s ` +
      `(${(MAX_LEG_S * FORWARD_MPS).toFixed(2)} m estimated). Choose a closer destination ` +
      'rather than silently truncating the command.'
    );
  }
  // TF uses milliseconds; rounding introduces at most 0.5 ms of timing error.
  const durationS = Math.round(estimatedTotalS * 1000) / 1000;
  if (durationS < MIN_LEG_S || durationS > MAX_LEG_S) {
    throw new Error('The calculated TF duration is outside the permitted 0.100–300.000 s range.');
  }
  const sequence = `TF${durationS.toFixed(3)}`;
  return {
    protocol: 'A31_TIMED', firmware: 'A3.1', sequence,
    createdAt: now, origin: [...start.coords], originSource: start.source,
    destination: [...target], destinationPin: pinIndex + 1,
    // These fields preserve compatibility with the rollback experiment recorder.
    legs: [{ pin: pinIndex + 1, coordinates: [...target], distanceM, bearingDegrees: bearing }],
    distanceM, bearing, estimatedTotalS, durationS,
    estimatedLegM: durationS * FORWARD_MPS,
    partial: false, // All accepted missions represent the entire estimated A-to-B leg.
    limitations: 'Forward timed travel only; manually aligned heading, no onboard coordinate targeting or automatic arrival confirmation.'
  };
}
