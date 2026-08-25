// Earth radius in meters
const R = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * Calculates distance in meters between two [lat, lng] points
 */
export function calculateDistanceMeters(point1, point2) {
  if (!point1 || !point2) return 0;
  const lat1 = toRad(point1[0]);
  const lat2 = toRad(point2[0]);
  const deltaLat = toRad(point2[0] - point1[0]);
  const deltaLng = toRad(point2[1] - point1[1]);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // Round to 1 decimal place
}

/**
 * Calculates forward azimuth bearing (0-360 degrees) from point1 to point2
 */
export function calculateBearing(point1, point2) {
  if (!point1 || !point2) return 0;
  const lat1 = toRad(point1[0]);
  const lat2 = toRad(point2[0]);
  const deltaLng = toRad(point2[1] - point1[1]);

  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  let brng = toDeg(Math.atan2(y, x));
  return Math.round((brng + 360) % 360);
}

/**
 * Converts degrees into 8-wind cardinal directions
 */
export function degreesToCardinal(deg) {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(deg / 45) % 8;
  return cardinals[index];
}