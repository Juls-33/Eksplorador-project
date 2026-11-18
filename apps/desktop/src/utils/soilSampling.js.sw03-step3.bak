// Receiver-time observation window. Timing is based on local receipt rather than rover timestamps.
// First 5 s are a LoRa arrival buffer; a full 5-minute observation follows.
export const SOIL_LEAD_IN_MS = 5_000;
export const SOIL_OBSERVATION_MS = SOIL_LEAD_IN_MS + 300_000;
export const SOIL_STALE_MS = 30_000;
export const MIN_AVERAGE_READINGS = 3;

export const toSensorNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Firmware EC is in µS/cm. This is an *estimated* TDS quantity, not ECe or independent salt assay.
export function estimatedTdsMgL(ecMicroSiemens) {
  const ec = toSensorNumber(ecMicroSiemens);
  return ec === null || ec < 0 ? null : Math.round(ec * 0.60 * 10) / 10;
}

export function ecDsM(ecMicroSiemens) {
  const ec = toSensorNumber(ecMicroSiemens);
  return ec === null ? null : ec / 1000;
}

const FIELDS = ['moisture', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium'];
export function summarizeSoilSession(readings, startedAt, endAt = startedAt + SOIL_OBSERVATION_MS) {
  // Intentionally exclude the lead-in window and samples received after completion.
  const eligible = readings.filter(r => {
    if (r.receivedAt - startedAt < SOIL_LEAD_IN_MS || r.receivedAt > endAt) return false;
    const moisture = toSensorNumber(r.data.moisture);
    const ph = toSensorNumber(r.data.ph);
    const ec = toSensorNumber(r.data.ec);
    return moisture !== null && moisture >= 0 && moisture <= 100 &&
      ph !== null && ph >= 0 && ph <= 14 && ec !== null && ec >= 0;
  });
  const averages = {};
  for (const field of FIELDS) {
    const values = eligible.map(r => toSensorNumber(r.data[field])).filter(v => v !== null);
    averages[field] = values.length ? values.reduce((a,b) => a + b,0) / values.length : null;
  }
  return { ...averages, count: eligible.length, totalRaw: readings.length };
}

export function samplingPhase(session, now) {
  if (!session) return { phase: 'idle', remainingMs: 0 };
  if (session.completed) return { phase: 'ready', remainingMs: 0 };
  if (now - session.startedAt < SOIL_LEAD_IN_MS) {
    return { phase: 'lead-in', remainingMs: SOIL_LEAD_IN_MS - (now - session.startedAt) };
  }
  if (now - session.startedAt < SOIL_OBSERVATION_MS) {
    return { phase: 'observing', remainingMs: SOIL_OBSERVATION_MS - (now - session.startedAt) };
  }
  if (now - session.lastSeen > SOIL_STALE_MS) return { phase: 'stale', remainingMs: 0 };
  if (summarizeSoilSession(session.readings, session.startedAt).count < MIN_AVERAGE_READINGS) {
    return { phase: 'insufficient', remainingMs: 0 };
  }
  return { phase: 'finalize', remainingMs: 0 };
}

export function formatTimeLeft(ms) {
  const total = Math.ceil(Math.max(ms, 0) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
