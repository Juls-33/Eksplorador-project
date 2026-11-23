import { calculatePolygonArea } from './geo.js';

// Operator-editable planning reference, not a field creation or safety limit.
export const DEFAULT_FIELD_AREA_REFERENCE = Object.freeze({ min: 500, max: 1000 });

export function summarizeDraftFieldArea(boundary, targetMin = 500, targetMax = 1000) {
  const points = Array.isArray(boundary) ? boundary.length : 0;
  const min = Number(targetMin);
  const max = Number(targetMax);
  const validTarget = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
  const sqm = points >= 3 ? calculatePolygonArea(boundary) : null;
  const validArea = sqm !== null && Number.isFinite(sqm) && sqm > 0;
  const status = points < 3 ? 'incomplete'
    : !validArea ? 'invalid'
    : !validTarget ? 'no-target'
    : sqm < min ? 'below'
    : sqm > max ? 'above'
    : 'within';
  return {
    points,
    sqm,
    hectares: validArea ? sqm / 10000 : null,
    validArea,
    validTarget,
    targetMin: min,
    targetMax: max,
    status,
    aboveFactor: status === 'above' ? sqm / max : null,
    progressPercent: validArea && validTarget ? Math.min(100, Math.max(0, sqm / max * 100)) : 0
  };
}

export const formatSquareMeters = (sqm) => Number.isFinite(sqm)
  ? new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(sqm)
  : '—';

export const formatHectares = (hectares) => Number.isFinite(hectares)
  ? new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(hectares)
  : '—';
