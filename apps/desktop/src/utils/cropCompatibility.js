// Transparent, per-sample screening using preferred crop requirements.
// Not a yield forecast, laboratory nutrient test, or whole-land suitability model.
const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export function evaluateCropCompatibility(sample, thresholds = {}, soilType = '', compatibleSoilTypes = []) {
  const result = {
    checked: 0,
    failed: [],
    criteria: {
      ph: { status: 'unavailable', deviation: null, value: null },
      soilType: { status: 'unavailable', value: soilType || null }
    },
    status: 'insufficient'
  };

  const low = thresholds?.minPh, high = thresholds?.maxPh;
  const phReady = hasNumber(sample?.ph) && hasNumber(low) && hasNumber(high) &&
    Number(low) < Number(high) && Number(sample.ph) >= 0 && Number(sample.ph) <= 14;

  if (phReady) {
    const ph = Number(sample.ph);
    const min = Number(low), max = Number(high);
    const below = ph < min, above = ph > max;
    const deviation = below ? Number((min - ph).toFixed(2)) : above ? Number((ph - max).toFixed(2)) : 0;
    result.criteria.ph = {
      status: below ? 'below' : above ? 'above' : 'match',
      value: ph, deviation
    };
    result.checked++;
    if (below || above) result.failed.push('ph');
  }

  const preferred = Array.isArray(compatibleSoilTypes) ? compatibleSoilTypes : [];
  if (soilType && preferred.length) {
    const matches = preferred.includes(soilType);
    result.criteria.soilType = { status: matches ? 'match' : 'review', value: soilType };
    result.checked++;
    if (!matches) result.failed.push('soil_type');
  }

  result.status = !phReady ? 'insufficient' : result.failed.length ? 'review' : 'matched';
  return result;
}

export function summarizeCropCompatibility(samples, thresholds, soilType, compatibleSoilTypes = []) {
  const evaluated = (samples || []).map(sample => ({
    sample,
    ...evaluateCropCompatibility(sample, thresholds, soilType, compatibleSoilTypes)
  }));
  const counts = {
    total: evaluated.length,
    matched: evaluated.filter(r => r.status === 'matched').length,
    review: evaluated.filter(r => r.status === 'review').length,
    insufficient: evaluated.filter(r => r.status === 'insufficient').length,
    phMatched: evaluated.filter(r => r.criteria.ph.status === 'match').length,
    soilMatched: evaluated.filter(r => r.criteria.soilType.status === 'match').length,
    soilReviewed: evaluated.filter(r => r.criteria.soilType.status === 'review').length,
    soilNotEvaluated: evaluated.filter(r => r.criteria.soilType.status === 'unavailable').length,
  };
  return { evaluated, counts };
}
