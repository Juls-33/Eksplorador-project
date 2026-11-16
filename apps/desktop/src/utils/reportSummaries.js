// Report data model. All aggregates use finalized/legacy telemetry records only,
// never the raw packets stored in mission_soil_readings. This module stays pure
// so its interpretation can be tested without launching Tauri or the rover.
import { appDate } from './time.js';
import { ecDsM, estimatedTdsMgL } from './soilSampling.js';
import { summarizeCropCompatibility } from './cropCompatibility.js';

const valid = (value, minimum, maximum = Infinity) => {
  if (value === null || value === undefined || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
};

const validDate = timestamp => {
  const date = String(timestamp ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date ? '' : date;
};

const hasId = v => v !== null && v !== undefined && String(v).trim() !== '';
const normalizeName = v => String(v ?? '').trim().toLowerCase();
const fmt = (value, digits = 1, suffix = '') =>
  value === null ? 'N/A' : `${value.toFixed(digits)}${suffix}`;

// A reportable observation needs an actual soil measurement, not just an empty
// telemetry row or a set of GPS coordinates. Recorded zeros are valid values.
const SENSOR_LIMITS = {
  moisture: [0, 100], ph: [0, 14], ec: [0, Infinity],
  nitrogen: [0, Infinity], phosphorus: [0, Infinity], potassium: [0, Infinity]
};
export const hasSoilMeasurement = row => Object.entries(SENSOR_LIMITS)
  .some(([key, range]) => valid(row?.[key], ...range));

export function summarizeParameter(rows, key) {
  const range = {
    moisture: [0, 100], ph: [0, 14], ec: [0, Infinity],
    nitrogen: [0, Infinity], phosphorus: [0, Infinity], potassium: [0, Infinity]
  }[key] || [-Infinity, Infinity];
  const values = (rows || [])
    .map(r => r?.[key])
    .filter(v => valid(v, ...range))
    .map(Number);
  if (!values.length) return { min: null, max: null, mean: null, validCount: 0 };
  // Avoid spreading very long record arrays as variadic Math.min arguments.
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of values) { min = Math.min(min, x); max = Math.max(max, x); sum += x; }
  return { min, max, mean: sum / values.length, validCount: values.length };
}

function coordinatesValid(row) {
  return valid(row.latitude, -90, 90) && valid(row.longitude, -180, 180);
}

// A displayed report must be anchored to an EXISTING field. Mission association
// is authoritative when a valid mission exists; missionless records can only
// use an unambiguous, exact field-name match. Orphaned records stay in SQLite.
function chooseReportGroups(records, fields, missions) {
  const savedFields = (fields || []).filter(f => hasId(f?.id) && normalizeName(f?.name));
  const fieldsById = new Map(savedFields.map(f => [String(f.id).trim(), f]));
  const fieldsByName = new Map();
  for (const field of savedFields) {
    const key = normalizeName(field.name);
    if (!fieldsByName.has(key)) fieldsByName.set(key, []);
    fieldsByName.get(key).push(field);
  }
  const missionsById = new Map((missions || [])
    .filter(m => hasId(m?.id) && hasId(m?.fieldId))
    .map(m => [String(m.id).trim(), m]));
  const groups = new Map();

  for (const row of records || []) {
    if (!hasSoilMeasurement(row)) continue;
    const missionId = hasId(row?.mission_id) ? String(row.mission_id).trim() : null;
    const mission = missionId ? missionsById.get(missionId) : null;
    let field;
    if (missionId) {
      // Never reassign an orphaned mission to another field based on its free-text plot.
      if (!mission) continue;
      field = fieldsById.get(String(mission.fieldId).trim());
    } else {
      const matches = fieldsByName.get(normalizeName(row.plot)) || [];
      if (matches.length !== 1) continue;
      field = matches[0];
    }
    if (!field) continue;

    const date = validDate(row.timestamp);
    // All undated, missionless samples for the same real field form ONE group.
    // They are not rendered as hundreds of one-row legacy reports.
    const key = missionId
      ? `mission:${missionId}`
      : `field:${field.id}:${date || 'UNDATED'}`;
    if (!groups.has(key)) groups.set(key, {
      key, field, missionId, mission: mission || null,
      plot: String(field.name).trim(), rows: [], legacyGrouping: !missionId
    });
    groups.get(key).rows.push(row);
  }
  return Array.from(groups.values());
}

function stableReportId(group) {
  if (group.missionId !== null) return `RPT-MISSION-${encodeURIComponent(group.missionId)}`;
  const date = validDate(group.rows[0]?.timestamp) || 'UNDATED';
  return `RPT-FIELD-${encodeURIComponent(String(group.field.id))}-${date}`;
}

export function processTelemetryToReports(records, fields = [], cropProfiles = [], missions = []) {
  if (!Array.isArray(records) || !records.length) return [];
  const groups = chooseReportGroups(records, fields, missions || []);
  const result = groups.map(group => {
    const rows = group.rows;
    const field = group.field;
    const soilType = field?.soilType || '';
    const metrics = Object.fromEntries(
      ['moisture', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium']
        .map(key => [key, summarizeParameter(rows, key)])
    );
    const { moisture, ph, ec, nitrogen: n, phosphorus: p, potassium: k } = metrics;
    const dates = rows.map(r => validDate(r.timestamp)).filter(Boolean).sort();
    const startDate = dates[0] || null, endDate = dates[dates.length - 1] || null;
    const surveyDate = startDate ? (startDate === endDate ? startDate : `${startDate} to ${endDate}`) : 'Date not recorded';
    const geoRows = rows.filter(coordinatesValid);
    const locationsCount = new Set(geoRows.map(r =>
      `${Number(r.latitude).toFixed(6)},${Number(r.longitude).toFixed(6)}`
    )).size;
    const sessionLinkedCount = rows.filter(r => hasId(r.sample_session_id)).length;
    const unlinkedCount = rows.length - sessionLinkedCount;

    const recommendedCrops = (cropProfiles || []).map(c => {
      const { counts } = summarizeCropCompatibility(rows, c.thresholds, soilType, c.compatibleSoilTypes || []);
      const phEvaluated = counts.total - counts.insufficient;
      const textureAvailable = soilType && Array.isArray(c.compatibleSoilTypes) && c.compatibleSoilTypes.length > 0;
      const soilMessage = textureAvailable
        ? `Operator soil type: ${soilType}; ${counts.soilReviewed} sample(s) outside preferred textures.`
        : 'Soil texture was not evaluated (field type or crop reference unavailable).';
      return {
        name: c.name,
        match: phEvaluated > 0 ? `${counts.phMatched}/${phEvaluated} valid pH readings match` : 'No valid pH readings',
        ratio: phEvaluated ? counts.phMatched / phEvaluated : -1,
        note: `${counts.matched} match assessed preferences; ${counts.review} need review; ${counts.insufficient} lack valid pH. ${soilMessage} Other growing conditions are not assessed.`
      };
    }).sort((a,b) => b.ratio - a.ratio || a.name.localeCompare(b.name));
    if (!recommendedCrops.length) recommendedCrops.push({
      name: 'No crop profiles configured', match: 'Not evaluated', ratio: -1,
      note: 'Create crop profiles with documented pH preferences in Crop Assessment.'
    });

    const recommendations = [
      'Review sample-level pH compatibility and operator-tagged soil texture for each crop. This is a preliminary screening, not a yield prediction.',
      ec.mean === null
        ? 'No valid EC readings were available; EC and derived TDS cannot be summarized.'
        : `Mean field EC: ${fmt(ecDsM(ec.mean), 3, ' dS/m')}; EC-derived estimated TDS: ${fmt(estimatedTdsMgL(ec.mean), 1, ' mg/L')}. Direct field EC is not laboratory ECe.`,
      'N, P and K are conductivity-derived sensor estimates influenced by moisture; do not infer specific nutrient deficiencies or fertilizer quantities.',
      'If readings lie outside a crop\'s preferred pH range, consult local agricultural guidance before selecting treatments.'
    ];
    if (group.legacyGrouping) recommendations.push(
      'This is a field-linked record group without a verified mission; records were grouped by saved field and date, with undated records grouped together.'
    );

    const parameterRow = (label, stat, decimals, suffix, status, convert = x => x) => ({
      parameter: label,
      min: stat.validCount ? fmt(convert(stat.min), decimals, suffix) : 'N/A',
      max: stat.validCount ? fmt(convert(stat.max), decimals, suffix) : 'N/A',
      mean: stat.validCount ? fmt(convert(stat.mean), decimals, suffix) : 'N/A',
      count: `${stat.validCount}/${rows.length}`,
      status
    });
    return {
      id: stableReportId(group),
      fieldId: field.id,
      title: `Field Soil Monitoring Report — ${group.plot}`,
      missionId: group.missionId || 'No formal mission',
      plot: group.plot,
      surveyDate,
      sortDate: endDate || '',
      generatedDate: appDate(),
      inspector: 'Generated from Eksplorador records',
      soilTexture: soilType || 'Not operator-classified',
      fertilityGrade: 'Sensor-based summary · Nutrient status not assessed',
      stats: {
        samplesCount: rows.length,
        sessionLinkedCount, unlinkedCount,
        geotaggedCount: geoRows.length,
        locationsCount,
        avgMoisture: fmt(moisture.mean, 1, '%'),
        avgPh: fmt(ph.mean, 2),
        avgEC: fmt(ec.mean === null ? null : ecDsM(ec.mean), 3, ' dS/m'),
        n: fmt(n.mean, 0, ' mg/kg'),
        p: fmt(p.mean, 0, ' mg/kg'),
        k: fmt(k.mean, 0, ' mg/kg')
      },
      parameterVariance: [
        parameterRow('Soil Moisture', moisture, 1, '%', 'At sampling time'),
        parameterRow('Soil pH', ph, 2, '', 'Crop-specific pH screening'),
        parameterRow('Electrical Conductivity', ec, 3, ' dS/m', 'Field EC (not ECe)', ecDsM),
        parameterRow('Nitrogen (N)', n, 0, ' mg/kg', 'Sensor estimate'),
        parameterRow('Phosphorus (P)', p, 0, ' mg/kg', 'Sensor estimate'),
        parameterRow('Potassium (K)', k, 0, ' mg/kg', 'Sensor estimate')
      ],
      recommendedCrops,
      actionableRecommendations: recommendations,
      groupingNote: group.legacyGrouping ? 'Saved field: missionless samples grouped by date' : 'Mission-linked record',
      sampleDetails: rows.map(r => ({
        id: r.id ?? null,
        timestamp: r.timestamp || 'N/A',
        source: hasId(r.sample_session_id) ? '5-minute session-linked' : 'Legacy / unlinked',
        ph: valid(r.ph, 0, 14) ? Number(r.ph).toFixed(2) : 'N/A',
        moisture: valid(r.moisture, 0, 100) ? `${Number(r.moisture).toFixed(1)}%` : 'N/A',
        ec: valid(r.ec, 0) ? `${Number(r.ec).toFixed(0)} µS/cm` : 'N/A',
        geotag: coordinatesValid(r) ? (r.location_source || 'Geotagged') : 'Not geotagged'
      }))
    };
  });
  // Sorting or filtering never changes a report's stable mission / legacy identity.
  return result.sort((a,b) => b.sortDate.localeCompare(a.sortDate) || a.id.localeCompare(b.id));
}
