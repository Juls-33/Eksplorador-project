// Field Map layers represent real measured parameters, never an aggregate
// soil-health or fertilizer-deficiency score. IDW operates on raw values first.
import { MOISTURE_LAYER, PH_LAYER } from './layerBands.js';

const valid = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const RELATIVE_HEAT_GRADIENT = Object.freeze({
  0.1: '#b45309',
  0.5: '#06b6d4',
  0.9: '#1d4ed8'
});

export const FIELD_HEAT_LAYERS = Object.freeze({
  ph: {
    label: 'Soil pH — Acidity / Alkalinity', unit: 'pH',
    extractValue: row => valid(row.ph),
    valueToIntensity: PH_LAYER.intensity,
    gradient: PH_LAYER.gradient,
    ranges: PH_LAYER.legend,
    note: 'Descriptive acidity categories only; crop suitability and treatment needs depend on the selected crop and soil.'
  },
  moisture: {
    label: 'Soil Moisture — Sampling Snapshot', unit: '%',
    extractValue: row => valid(row.moisture),
    valueToIntensity: MOISTURE_LAYER.intensity,
    gradient: MOISTURE_LAYER.gradient,
    ranges: MOISTURE_LAYER.legend,
    note: 'Moisture is a time-specific observation. Colors do not imply crop-independent optimum or permanent drought.'
  },
  ec: {
    label: 'Electrical Conductivity — Relative', unit: 'µS/cm',
    extractValue: row => valid(row.ec),
    gradient: RELATIVE_HEAT_GRADIENT,
    note: 'Relative field EC. Conductivity is influenced by salts, moisture, soil texture and temperature; not a fertilizer-deficiency measurement.'
  },
  nitrogen: {
    label: 'Nitrogen (N) — Sensor Estimate', unit: 'sensor mg/kg',
    extractValue: row => valid(row.n ?? row.nitrogen),
    gradient: RELATIVE_HEAT_GRADIENT,
    note: 'Conductivity-derived YAGO sensor output. Relative readings are not laboratory-verified nitrogen concentration or deficiency.'
  },
  phosphorus: {
    label: 'Phosphorus (P) — Sensor Estimate', unit: 'sensor mg/kg',
    extractValue: row => valid(row.p ?? row.phosphorus),
    gradient: RELATIVE_HEAT_GRADIENT,
    note: 'Conductivity-derived YAGO sensor output. Relative readings are not laboratory-verified phosphorus concentration or deficiency.'
  },
  potassium: {
    label: 'Potassium (K) — Sensor Estimate', unit: 'sensor mg/kg',
    extractValue: row => valid(row.k ?? row.potassium),
    gradient: RELATIVE_HEAT_GRADIENT,
    note: 'Conductivity-derived YAGO sensor output. Relative readings are not laboratory-verified potassium concentration or deficiency.'
  }
});

export function relativeColorScale(readings) {
  const numbers = (readings || []).map(valid).filter(v => v !== null);
  if (!numbers.length) return { min: null, max: null, toIntensity: () => null };
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const toIntensity = value => {
    const n = valid(value);
    if (n === null) return null;
    // A constant field has no 'low' or 'high' difference to color.
    if (Math.abs(max - min) < 1e-12) return 0.5;
    return 0.1 + 0.8 * Math.max(0, Math.min(1, (n - min) / (max - min)));
  };
  return { min, max, toIntensity };
}

const displayNumber = n => Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1);

export function fieldLayerPresentation(layerKey, samples = []) {
  const layer = FIELD_HEAT_LAYERS[layerKey] ?? FIELD_HEAT_LAYERS.ph;
  if (layer.valueToIntensity) return layer;
  const scale = relativeColorScale(samples.map(layer.extractValue));
  const ranges = scale.min === null ? [] :
    scale.min === scale.max
      ? [{ color: '#06b6d4', label: displayNumber(scale.min), desc: 'Only one observed level' }]
      : [
          { color: '#1d4ed8', label: displayNumber(scale.max), desc: 'Highest observed' },
          { color: '#06b6d4', label: displayNumber((scale.min+scale.max)/2), desc: 'Middle of observed range' },
          { color: '#b45309', label: displayNumber(scale.min), desc: 'Lowest observed' }
        ];
  return { ...layer, ranges, valueToIntensity: scale.toIntensity };
}
