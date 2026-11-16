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

export function calculateDistance(coord1, coord2) {
  if (!coord1 || !coord2) return 0;
  const [lat1, lon1] = coord1;
  const [lat2, lon2] = coord2;

  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Consolidate repeated readings recorded at effectively the same map location.
 * Such duplicates must not receive more spatial voting power than one sampling site.
 */
export function consolidateHeatPoints(points, mergeRadiusM = 0.75) {
  const clusters = [];
  for (const item of points || []) {
    if (!Array.isArray(item) || item.length < 3 || !item.every(Number.isFinite)) continue;
    const [lat, lng, value] = item;
    let cluster = clusters.find(c => calculateDistanceMeters([c.lat, c.lng], [lat, lng]) <= mergeRadiusM);
    if (!cluster) {
      cluster = { lat, lng, sum: 0, count: 0 };
      clusters.push(cluster);
    }
    cluster.sum += value;
    cluster.count += 1;
  }
  return clusters.map(c => [c.lat, c.lng, c.sum / c.count]);
}

/**
 * IDW Spatial Interpolation for Continuous Field Coverage
 * @param {Array} samplePoints Array of [lat, lng, measured value]
 * @param {Array} boundaryPolygon Array of [lat, lng]
 * @param {Object} options Configuration options
 * @returns {Array} Array of interpolated points [lat, lng, measured value]
 */
export function generateIDWHeatmapGrid(
  samplePoints,
  boundaryPolygon,
  {
    gridResolution = 28,      // Density of interpolation mesh
    power = 2.0,              // Distance decay exponent (Shepard's method)
    maxInfluenceRadiusM = 45, // Maximum sensor prediction radius in meters
    minNeighbors = 1        // At least 2 sites recommended for spatial claims
  } = {}
) {
  const uniquePoints = consolidateHeatPoints(samplePoints);
  if (!uniquePoints.length) return [];
  if (!boundaryPolygon || boundaryPolygon.length < 3) return uniquePoints;

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
      let neighbors = 0;
      let minDistance = Infinity;
      let exactMatch = null;

      for (let i = 0; i < uniquePoints.length; i++) {
        const [sLat, sLng, intensity] = uniquePoints[i];
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
          neighbors += 1;
        }
      }

      if (exactMatch !== null) {
        interpolatedGrid.push([lat, lng, exactMatch]);
      } else if (totalWeight > 0 && neighbors >= minNeighbors) {
        const predictedIntensity = weightedSum / totalWeight;

        // Do not fabricate low moisture at the edge of an unsampled region.
        interpolatedGrid.push([lat, lng, predictedIntensity]);
      }
    }
  }

  // A weighted mean cannot exceed its observed input range.
  // Include one representative point per site, not every duplicate packet.
  return [...interpolatedGrid, ...uniquePoints];
}