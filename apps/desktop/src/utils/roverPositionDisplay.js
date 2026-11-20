// Map-display-only GPS continuity. NEVER use for soil geotags, navigation,
// mission planning, automated control, or as a claimed GPS/DR fix.
export const LAST_KNOWN_GPS_DISPLAY_MS = 30_000;

export function validDisplayCoords(coords) {
  return Array.isArray(coords) && coords.length === 2 &&
    coords.every(Number.isFinite) &&
    coords[0] >= -90 && coords[0] <= 90 &&
    coords[1] >= -180 && coords[1] <= 180 &&
    !(coords[0] === 0 && coords[1] === 0);
}

export function resolveLastKnownGpsDisplay(lastFix, now, receiverConnected) {
  const unavailable = { position: null, mode: 'UNAVAILABLE', ageMs: null };
  if (!receiverConnected || !lastFix || !validDisplayCoords(lastFix.position) ||
      !Number.isFinite(lastFix.receivedAt) || !Number.isFinite(now)) return unavailable;
  const ageMs = now - lastFix.receivedAt;
  if (ageMs < 0 || ageMs > LAST_KNOWN_GPS_DISPLAY_MS) return unavailable;
  return { position: lastFix.position, mode: 'LAST_KNOWN', ageMs };
}
