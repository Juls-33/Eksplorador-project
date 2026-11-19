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

/** One value per location: measured, local estimate, or bounded IDW estimate.
 * Local coverage is a display assumption, not a measured soil footprint.
 * Opacity fades only in the outer 30% and never scales the soil value.
 * Pass consolidated sites so duplicate readings cannot gain spatial weight.
 */
export function evaluateHeatmapPoint(point, sites, {
  power = 2,
  maxInfluenceRadiusM = 45,
  minNeighbors = 1,
  localCoverageRadiusM = 5
} = {}) {
  const radius = Math.max(0, Number(maxInfluenceRadiusM) || 0);
  const localRadius = Math.min(radius, Math.max(0, Number(localCoverageRadiusM) || 0));
  const required = Math.max(1, Math.floor(Number(minNeighbors) || 1));
  const nearby = sites.map(([lat, lng, value]) => ({
    distance: calculateDistance(point, [lat, lng]), value
  })).sort((a, b) => a.distance - b.distance);
  if (!nearby.length) return null;
  const nearest = nearby[0];
  if (nearest.distance < 0.5) return { value: nearest.value, opacity: 1, kind: 'measured' };
  const fade = (distance, limit) => {
    if (limit <= 0 || distance >= limit) return 0;
    const t = Math.max(0, Math.min(1, (limit - distance) / (limit * 0.3)));
    return t * t * (3 - 2 * t);
  };
  const localOpacity = fade(nearest.distance, localRadius);
  const neighbors = nearby.filter(site => site.distance <= radius);
  if (neighbors.length >= required) {
    let weightedSum = 0, totalWeight = 0;
    for (const site of neighbors) {
      const weight = 1 / Math.pow(site.distance, power);
      weightedSum += site.value * weight;
      totalWeight += weight;
    }
    const opacity = Math.max(localOpacity, fade(neighbors[required - 1].distance, radius));
    if (opacity > 0) return { value: weightedSum / totalWeight, opacity, kind: 'interpolated' };
  }
  if (localOpacity > 0) return { value: nearest.value, opacity: localOpacity, kind: 'local' };
  return null;
}

/** Bounded IDW grid, with optional alpha as the fourth tuple element.
 * Default triples preserve compatibility with existing callers.
 */
export function generateIDWHeatmapGrid(samplePoints, boundaryPolygon, options = {}) {
  const { gridResolution = 28, includeCoverage = false } = options;
  const sites = consolidateHeatPoints(samplePoints);
  if (!sites.length) return [];
  if (!boundaryPolygon || boundaryPolygon.length < 3) {
    return sites.map(site => includeCoverage ? [...site, 1] : site);
  }
  const minLat = Math.min(...boundaryPolygon.map(p => p[0]));
  const maxLat = Math.max(...boundaryPolygon.map(p => p[0]));
  const minLng = Math.min(...boundaryPolygon.map(p => p[1]));
  const maxLng = Math.max(...boundaryPolygon.map(p => p[1]));
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite) ||
      maxLat <= minLat || maxLng <= minLng) return [];
  const resolution = Math.max(1, Math.floor(Number(gridResolution) || 28));
  const grid = [];
  for (let row = 0; row <= resolution; row++) {
    const lat = minLat + (maxLat - minLat) * row / resolution;
    for (let col = 0; col <= resolution; col++) {
      const lng = minLng + (maxLng - minLng) * col / resolution;
      if (!isPointInPolygon([lat, lng], boundaryPolygon)) continue;
      const result = evaluateHeatmapPoint([lat, lng], sites, options);
      if (!result) continue;
      grid.push(includeCoverage ? [lat, lng, result.value, result.opacity] : [lat, lng, result.value]);
    }
  }
  // Preserve source values while respecting the field clipping polygon.
  for (const site of sites) {
    if (isPointInPolygon(site, boundaryPolygon)) grid.push(includeCoverage ? [...site, 1] : site);
  }
  return grid;
}
