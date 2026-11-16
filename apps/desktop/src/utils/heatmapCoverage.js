/**
 * Presentation-only footprint for a non-additive IDW raster.
 * Spatial support changes opacity only; measured values and IDW weights
 * are never adjusted by these functions.
 */
import { calculateDistanceMeters, consolidateHeatPoints } from './geo.js';

const METERS_PER_DEG_LAT = 111_320;
const clamp01 = value => Math.min(1, Math.max(0, value));

/**
 * Expand the temporary LIVE/HISTORICAL heatmap canvas far enough to contain
 * the entire distance-limited support region. This rectangle is a canvas
 * extent, not a soil field boundary or a rectangular area of prediction.
 */
export function autoHeatmapBoundary(points, radiusM = 25) {
  const valid = (points || []).filter(p => Array.isArray(p) && p.length >= 3 &&
    p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
  if (!valid.length) return [];
  const latitudes = valid.map(p => p[0]);
  const longitudes = valid.map(p => p[1]);
  const meanLat = latitudes.reduce((sum, v) => sum + v, 0) / latitudes.length;
  const radius = Math.max(1, Number.isFinite(radiusM) ? radiusM : 25);
  // Include one extra margin so the full transparency edge occurs INSIDE the
  // canvas. At 25m the padding is ~30m, not the former fixed 0.00015 degrees.
  const paddingM = radius * 1.2;
  const latPad = paddingM / METERS_PER_DEG_LAT;
  const lngPad = paddingM / (METERS_PER_DEG_LAT * Math.max(0.1, Math.cos(meanLat * Math.PI / 180)));
  const south = Math.min(...latitudes) - latPad;
  const north = Math.max(...latitudes) + latPad;
  const west = Math.min(...longitudes) - lngPad;
  const east = Math.max(...longitudes) + lngPad;
  return [[south, west], [south, east], [north, east], [north, west]];
}

/**
 * Feather support at the Nth-nearest DISTINCT sampling site. Requiring the
 * Nth site prevents a lone GPS packet from painting a broad heatmap; the
 * existing IDW layer continues to supply the actual predicted measurement.
 * Smoothstep prevents visible seams at the end of the radius.
 */
export function heatmapCoverageOpacity(point, distinctSites, radiusM = 25, minNeighbors = 2) {
  const sites = distinctSites || [];
  const minimum = Math.max(1, Math.trunc(minNeighbors));
  if (sites.length < minimum || !Number.isFinite(radiusM) || radiusM <= 0) return 0;
  const distances = sites
    .map(site => calculateDistanceMeters(point, site))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const distance = distances[minimum - 1];
  if (distance === undefined || distance >= radiusM) return 0;
  const start = radiusM * 0.55;
  if (distance <= start) return 1;
  const t = clamp01((distance - start) / (radiusM - start));
  return 1 - (t * t * (3 - 2 * t));
}

/** Prefer one representative per physical location for both IDW and alpha. */
export function heatmapSupportSites(points) {
  return consolidateHeatPoints(points).map(([lat, lng]) => [lat, lng]);
}
