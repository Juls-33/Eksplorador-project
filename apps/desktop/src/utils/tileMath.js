// Standard Slippy Map tile math (https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames).
// Shared between scripts/download-tiles.mjs (Node) and services/tileStorage.js (in-app) so
// the two can never compute a different tile range for the same bounding box.

export function lonToTileX(lon, z) {
  const n = 2 ** z;
  return Math.floor(((lon + 180) / 360) * n);
}

export function latToTileY(lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Computes, per zoom level in [minZoom, maxZoom], the tile x/y range covering
// {south, west, north, east} and how many tiles that is.
export function planArea({ south, west, north, east, minZoom, maxZoom }) {
  const perZoom = [];
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const xMin = clamp(lonToTileX(west, z), 0, n - 1);
    const xMax = clamp(lonToTileX(east, z), 0, n - 1);
    // North has the smaller tile-y; south has the larger one.
    const yMin = clamp(latToTileY(north, z), 0, n - 1);
    const yMax = clamp(latToTileY(south, z), 0, n - 1);
    const count = (xMax - xMin + 1) * (yMax - yMin + 1);
    perZoom.push({ z, xMin, xMax, yMin, yMax, count });
    total += count;
  }
  return { perZoom, total };
}

// Every individual {z, x, y} tile covered by a plan, in download order.
export function* iterateTiles(plan) {
  for (const zoomRange of plan.perZoom) {
    for (let x = zoomRange.xMin; x <= zoomRange.xMax; x++) {
      for (let y = zoomRange.yMin; y <= zoomRange.yMax; y++) {
        yield { z: zoomRange.z, x, y };
      }
    }
  }
}