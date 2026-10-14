// The moisture and pH classes for the heatmap layers, defined once.
//
// The legend text, the reading -> intensity formula and the color gradient are
// all derived from these bands, so they cannot drift apart (they had: the
// legend had gaps, and the dashboard and Field Map scaled the same reading
// differently). Both screens import from here.
//
// A reading belongs to the band its value falls in AFTER ROUNDING to the
// layer's step (1 % for moisture, 0.1 for pH) - so 5.76 counts as 5.8, and
// 55.4 % counts as 55 %. `lo`/`hi` are inclusive on that grid and the bands are
// contiguous: every possible reading lands in exactly one band.

function buildBandedLayer({ bands, step, floor, ceil }) {
  const n = bands.length;
  const slot = 0.9 / n; // each band owns an equal slice of the 0.1 - 1.0 intensity range
  // Sharp edges between bands. A wider blend would tint readings sitting right
  // at a band's edge (6.3, 35 %...) with the neighbouring color, and the map
  // would no longer match the legend. The heat layer's own blur softens them.
  const blend = slot * 0.01;
  const gridUnit = (value) => Math.round(value / step);
  const round4 = (x) => Number(x.toFixed(4));

  const bandIndexFor = (value) => {
    const unit = gridUnit(value);
    for (let i = 0; i < n; i += 1) {
      if (unit <= gridUnit(bands[i].hi)) return i;
    }
    return n - 1;
  };

  // Intensity is monotonic in the reading: it rises across the bands, and
  // within a band it rises with the value. Never below 0.1, so even the
  // lowest readings stay visible on the heat layer.
  const intensity = (value) => {
    const numeric = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
    if (value === null || value === undefined || !Number.isFinite(numeric)) return null;

    const i = bandIndexFor(numeric);
    const band = bands[i];
    const lower = i === 0 ? floor : (gridUnit(band.lo) - 0.5) * step;
    const upper = i === n - 1 ? ceil : (gridUnit(band.hi) + 0.5) * step;
    const t = Math.min(1, Math.max(0, (numeric - lower) / (upper - lower)));
    return round4(0.1 + i * slot + t * slot);
  };

  // Each band's slice is filled solid with its own color, so the map colors
  // line up with the legend.
  const gradient = {};
  bands.forEach((band, i) => {
    const start = 0.1 + i * slot;
    const end = start + slot;
    gradient[round4(i === 0 ? 0 : start + blend)] = band.color;
    gradient[round4(i === n - 1 ? 1 : end - blend)] = band.color;
  });

  // Legend rows, highest band first (the order the legend is shown in).
  const legend = [...bands].reverse().map(({ color, label, desc }) => ({ color, label, desc }));

  return { bands, intensity, gradient, legend, bandIndexFor };
}

export const MOISTURE_LAYER = buildBandedLayer({
  step: 1,
  floor: 0,
  ceil: 100,
  bands: [
    { lo: 0, hi: 24, color: '#ef4444', label: '< 25%', desc: 'Deficient / Very Dry' },
    { lo: 25, hi: 34, color: '#f97316', label: '25% - 34%', desc: 'Low / Drying' },
    { lo: 35, hi: 55, color: '#22c55e', label: '35% - 55%', desc: 'Optimal Moisture' },
    { lo: 56, hi: 60, color: '#38bdf8', label: '56% - 60%', desc: 'Moist / Slightly Wet' },
    { lo: 61, hi: 100, color: '#0284c7', label: '> 60%', desc: 'Saturated / Wet' }
  ]
});

export const PH_LAYER = buildBandedLayer({
  step: 0.1,
  floor: 4.0,
  ceil: 9.0,
  bands: [
    { lo: 0, hi: 5.5, color: '#dc2626', label: '\u2264 5.5', desc: 'Strongly Acidic' },
    { lo: 5.6, hi: 5.7, color: '#ea580c', label: '5.6 - 5.7', desc: 'Moderately Acidic' },
    { lo: 5.8, hi: 6.2, color: '#eab308', label: '5.8 - 6.2', desc: 'Slightly Acidic' },
    { lo: 6.3, hi: 7.0, color: '#16a34a', label: '6.3 - 7.0', desc: 'Optimal Neutral' },
    { lo: 7.1, hi: 7.4, color: '#2563eb', label: '7.1 - 7.4', desc: 'Slightly Alkaline' },
    { lo: 7.5, hi: 14, color: '#7c3aed', label: '\u2265 7.5', desc: 'Alkaline' }
  ]
});