// Historical soil comparison: how a mission's readings differ from an earlier one.
//
// Two bases are supported:
//  - "matched": current pins are paired one-to-one with the nearest baseline
//    sample within `radiusM`, and changes are averaged over those pairs only.
//    This isolates real change from "we sampled a different corner this time".
//  - "average": falls back to comparing whole-mission averages when fewer than
//    `minPairs` pins could be matched.

export const TRACKED_PARAMETERS = [
  { key: 'moisture', label: 'Moisture', unit: '%', decimals: 1, tolerance: 2 },
  { key: 'ph', label: 'pH', unit: '', decimals: 2, tolerance: 0.1 },
  { key: 'ec', label: 'EC', unit: 'dS/m', decimals: 2, tolerance: 0.05 },
  { key: 'n', label: 'Nitrogen', unit: 'mg/kg', decimals: 1, tolerance: 2 },
  { key: 'p', label: 'Phosphorus', unit: 'mg/kg', decimals: 1, tolerance: 2 },
  { key: 'k', label: 'Potassium', unit: 'mg/kg', decimals: 1, tolerance: 2 }
];

export const MATCH_RADIUS_M = 8;
export const MIN_MATCHED_PAIRS = 3;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const coordOf = (s) => {
  const lat = toNumber(s.lat ?? s.coords?.[0] ?? s.latitude);
  const lng = toNumber(s.lng ?? s.coords?.[1] ?? s.longitude);
  return lat === null || lng === null ? null : [lat, lng];
};

// Mean of every tracked parameter over a list of samples (missing readings skipped).
export function summarizeSamples(samples = []) {
  const avg = {};
  TRACKED_PARAMETERS.forEach((p) => {
    avg[p.key] = mean(samples.map((s) => toNumber(s[p.key])).filter((v) => v !== null));
  });
  return { count: samples.length, avg };
}

// One-to-one greedy matching by ascending distance, so no baseline sample is used twice.
export function matchSamples(currentSamples, baselineSamples, radiusM = MATCH_RADIUS_M) {
  const candidates = [];
  currentSamples.forEach((cur, ci) => {
    const cc = coordOf(cur);
    if (!cc) return;
    baselineSamples.forEach((base, bi) => {
      const bc = coordOf(base);
      if (!bc) return;
      const distance = haversineMeters(cc, bc);
      if (distance <= radiusM) candidates.push({ ci, bi, distance });
    });
  });

  candidates.sort((a, b) => a.distance - b.distance);
  const usedCurrent = new Set();
  const usedBaseline = new Set();
  const pairs = [];

  candidates.forEach(({ ci, bi, distance }) => {
    if (usedCurrent.has(ci) || usedBaseline.has(bi)) return;
    usedCurrent.add(ci);
    usedBaseline.add(bi);
    pairs.push({ current: currentSamples[ci], baseline: baselineSamples[bi], distanceM: distance });
  });

  return pairs;
}

export function compareSamples(currentSamples = [], baselineSamples = [], options = {}) {
  const radiusM = options.radiusM ?? MATCH_RADIUS_M;
  const minPairs = options.minPairs ?? MIN_MATCHED_PAIRS;

  const pairs = matchSamples(currentSamples, baselineSamples, radiusM);
  const useMatched = pairs.length >= minPairs;
  const currentSummary = summarizeSamples(currentSamples);
  const baselineSummary = summarizeSamples(baselineSamples);

  const rows = TRACKED_PARAMETERS.map((p) => {
    let current;
    let baseline;

    if (useMatched) {
      const both = pairs
        .map((pair) => [toNumber(pair.current[p.key]), toNumber(pair.baseline[p.key])])
        .filter(([c, b]) => c !== null && b !== null);
      current = mean(both.map(([c]) => c));
      baseline = mean(both.map(([, b]) => b));
    } else {
      current = currentSummary.avg[p.key];
      baseline = baselineSummary.avg[p.key];
    }

    const delta = current !== null && baseline !== null ? current - baseline : null;
    let trend = 'none';
    if (delta !== null) trend = Math.abs(delta) < p.tolerance ? 'stable' : delta > 0 ? 'up' : 'down';

    return { ...p, current, baseline, delta, trend };
  });

  return {
    basis: useMatched ? 'matched' : 'average',
    matchedCount: pairs.length,
    radiusM,
    currentCount: currentSamples.length,
    baselineCount: baselineSamples.length,
    rows
  };
}