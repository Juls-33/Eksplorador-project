// Field Map sampling provenance. This module never changes rover GPS or telemetry.
import { isPointInPolygon } from './geo.js';

export const SOIL_LOCATION_SOURCE = Object.freeze({
  GPS: 'GPS',
  OPERATOR_MAP: 'OPERATOR_MAP',
  MISSION_PIN: 'MISSION_PIN',
  UNLOCATED: 'UNLOCATED'
});

export function validSoilLocation(coords) {
  return Array.isArray(coords) && coords.length === 2 &&
    coords.every(value => value !== null && value !== '' && Number.isFinite(Number(value))) &&
    Math.abs(Number(coords[0])) <= 90 && Math.abs(Number(coords[1])) <= 180 &&
    !(Number(coords[0]) === 0 && Number(coords[1]) === 0);
}

export function isInsideSamplingField(coords, boundary) {
  return validSoilLocation(coords) &&
    (!Array.isArray(boundary) || boundary.length < 3 || isPointInPolygon(coords, boundary));
}

// A genuine GPS fix wins regardless of the UI toggle. Manual estimates are used
// ONLY for soil sample geotagging, never for the rover's measured GPS position.
export function resolveSoilSampleLocation({ gpsCoords, manualEnabled, manualSelection, boundary }) {
  const gpsValid = validSoilLocation(gpsCoords);
  if (gpsValid) {
    return isInsideSamplingField(gpsCoords, boundary)
      ? { coords: gpsCoords.map(Number), source: SOIL_LOCATION_SOURCE.GPS, outsideField: false }
      : { coords: null, source: SOIL_LOCATION_SOURCE.GPS, outsideField: true };
  }

  if (manualEnabled && manualSelection &&
      [SOIL_LOCATION_SOURCE.OPERATOR_MAP, SOIL_LOCATION_SOURCE.MISSION_PIN].includes(manualSelection.source) &&
      isInsideSamplingField(manualSelection.coords, boundary)) {
    return {
      coords: manualSelection.coords.map(Number),
      source: manualSelection.source,
      outsideField: false
    };
  }

  return { coords: null, source: SOIL_LOCATION_SOURCE.UNLOCATED, outsideField: false };
}
