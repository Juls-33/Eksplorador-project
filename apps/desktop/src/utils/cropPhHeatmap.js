// Presentation-only pH heatmap inputs for the Crop Assessment map.
// The existing Field Map raster interpolates the measured pH values; crop
// compatibility remains evaluated ONLY at sampled points by cropCompatibility.
export const CROP_PH_HEATMAP_SETTINGS = Object.freeze({
  localCoverageRadiusM: 20,
  maxInfluenceRadiusM: 25,
  minInterpolationNeighbors: 2
});

const numeric = value => {
  if (value === null || value === undefined || typeof value === 'boolean' ||
      (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function cropPhHeatPoints(samples = []) {
  if (!Array.isArray(samples)) return [];
  return samples.flatMap(sample => {
    const lat = numeric(sample?.lat);
    const lng = numeric(sample?.lng);
    const ph = numeric(sample?.ph);
    if (lat === null || lng === null || ph === null ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
        (lat === 0 && lng === 0) || ph < 0 || ph > 14) return [];
    return [[lat, lng, ph]];
  });
}

// Saved field boundaries are in [lat, lng] order, as expected by HeatmapMap.
// An absent/invalid boundary is handled by the renderer's radial fallback.
export function cropPhFieldBoundary(fields = [], selectedPlot = '') {
  const field = Array.isArray(fields) ? fields.find(entry => entry.name === selectedPlot) : null;
  const boundary = field?.boundary;
  if (!Array.isArray(boundary) || boundary.length < 3 || !boundary.every(point =>
    Array.isArray(point) && point.length === 2 &&
    point.every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180
  )) return [];
  return boundary;
}
