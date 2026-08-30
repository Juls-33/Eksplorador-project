// Earth radius in meters
const R = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

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
  return Math.round(R * c * 10) / 10;
}

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

export function degreesToCardinal(deg) {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(deg / 45) % 8;
  return cardinals[index];
}

export function isPointInPolygon(point, polygon) {
  if (!point || !polygon || polygon.length < 3) return true;
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function calculatePolygonArea(coords) {
  if (!coords || coords.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const xi = toRad(coords[i][1]) * R * Math.cos(toRad(coords[i][0]));
    const yi = toRad(coords[i][0]) * R;
    const xj = toRad(coords[j][1]) * R * Math.cos(toRad(coords[j][0]));
    const yj = toRad(coords[j][0]) * R;
    area += xi * yj - xj * yi;
  }
  return Math.round(Math.abs(area / 2));
}

/**
 * IDW Spatial Interpolation for Continuous Field Coverage
 * @param {Array} samplePoints Array of [lat, lng, intensity]
 * @param {Array} boundaryPolygon Array of [lat, lng]
 * @param {Object} options Configuration options
 * @returns {Array} Array of dense interpolated points [lat, lng, intensity]
 */
export function generateIDWHeatmapGrid(
  samplePoints,
  boundaryPolygon,
  {
    gridResolution = 28,      // Density of interpolation mesh
    power = 2.0,              // Distance decay exponent (Shepard's method)
    maxInfluenceRadiusM = 45  // Maximum sensor prediction radius in meters
  } = {}
) {
  if (!samplePoints || samplePoints.length === 0) return [];
  if (!boundaryPolygon || boundaryPolygon.length < 3) return samplePoints;

  // 1. Calculate Bounding Box of the Field Polygon
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  boundaryPolygon.forEach(([lat, lng]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  });

  const latStep = (maxLat - minLat) / gridResolution;
  const lngStep = (maxLng - minLng) / gridResolution;
  const interpolatedGrid = [];

  // 2. Scan and Interpolate Each Internal Cell
  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    for (let lng = minLng; lng <= maxLng; lng += lngStep) {
      const candidatePoint = [lat, lng];

      // Exclude non-soil / out-of-boundary regions
      if (!isPointInPolygon(candidatePoint, boundaryPolygon)) {
        continue;
      }

      let totalWeight = 0;
      let weightedSum = 0;
      let minDistance = Infinity;
      let exactMatch = null;

      for (let i = 0; i < samplePoints.length; i++) {
        const [sLat, sLng, intensity] = samplePoints[i];
        const dist = calculateDistanceMeters(candidatePoint, [sLat, sLng]);

        if (dist < minDistance) minDistance = dist;

        // Exact match at sensor coordinate
        if (dist < 0.5) {
          exactMatch = intensity;
          break;
        }

        // Apply weight if within influence radius
        if (dist <= maxInfluenceRadiusM) {
          const weight = 1 / Math.pow(dist, power);
          totalWeight += weight;
          weightedSum += weight * intensity;
        }
      }

      if (exactMatch !== null) {
        interpolatedGrid.push([lat, lng, exactMatch]);
      } else if (totalWeight > 0) {
        let predictedIntensity = weightedSum / totalWeight;

        // Smooth radial edge decay when approaching max influence distance
        if (minDistance > maxInfluenceRadiusM * 0.7) {
          const falloff = 1 - (minDistance - maxInfluenceRadiusM * 0.7) / (maxInfluenceRadiusM * 0.3);
          predictedIntensity *= Math.max(0.2, falloff);
        }

        interpolatedGrid.push([lat, lng, predictedIntensity]);
      }
    }
  }

  // Include original sampled points to preserve raw peaks
  return [...interpolatedGrid, ...samplePoints];
}