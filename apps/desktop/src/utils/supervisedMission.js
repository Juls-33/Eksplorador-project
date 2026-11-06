import { calculateBearing, calculateDistance } from './geo.js';
import { TIMED_LIMITS } from './timedMission.js';

export const GPS_FRESH_MS = 15000;
export const TIMED_MOVEMENT_AVAILABLE = true;
export const TIMED_MOVEMENT_NOTICE = 'Upload stages one short leg only. ACK2 confirms queued Mega UART delivery; Mega acceptance and execution remain operator unverified.';

// Initial outdoor measurements, not guaranteed physical accuracy. Adjust this
// source profile after further field tests; firmware limits remain independent.
export const MOVEMENT_PROFILE = Object.freeze({
  name: 'Field-tested A3.1',
  forwardMps: 0.25,
  leftDps: 112.5,
  rightDps: 112.5,
});

export function validCoordinates(coords) {
  return Array.isArray(coords) && coords.length === 2 &&
    coords.every(value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value))) &&
    Math.abs(Number(coords[0])) <= 90 && Math.abs(Number(coords[1])) <= 180 &&
    !(Number(coords[0]) === 0 && Number(coords[1]) === 0);
}

export function gpsPosition(data, receivedAt, now = Date.now()) {
  if (!data || !Number.isInteger(Number(data.satsLocked)) || Number(data.satsLocked) <= 0 ||
      !validCoordinates([data.lat, data.lng]) || !Number.isFinite(receivedAt) ||
      now < receivedAt || now - receivedAt > GPS_FRESH_MS) return null;
  return { coords: [Number(data.lat), Number(data.lng)], source: 'GPS_MEASURED', confirmedAt: receivedAt };
}

export function estimatedPosition(coords, now = Date.now()) {
  return validCoordinates(coords)
    ? { coords: coords.map(Number), source: 'OPERATOR_ESTIMATED', confirmedAt: now }
    : null;
}

export function validPosition(position, now = Date.now()) {
  if (!validCoordinates(position?.coords) || !Number.isFinite(position.confirmedAt) || position.confirmedAt > now) return false;
  if (position.source === 'OPERATOR_ESTIMATED') return true;
  return position.source === 'GPS_MEASURED' && Number.isFinite(position.confirmedAt) &&
    now >= position.confirmedAt && now - position.confirmedAt <= GPS_FRESH_MS;
}

// Offer one explicitly bounded leg. A partial pivot ends the leg before forward
// movement; every subsequent leg needs fresh operator planning/authorization.
export function planMovementLeg({ start, heading, target, now = Date.now() }) {
  if (!validPosition(start, now) || !validCoordinates(target)) return { error: 'Confirm a fresh GPS or operator-estimated starting position.' };
  if (heading === '' || heading === null || !Number.isFinite(Number(heading)) || Number(heading) < 0 || Number(heading) >= 360) {
    return { error: 'Confirm the actual rover heading from 0 to less than 360 degrees.' };
  }
  const { forwardMps, leftDps, rightDps } = MOVEMENT_PROFILE;
  if (![forwardMps, leftDps, rightDps].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    return { error: 'Movement profile contains invalid measured rates.' };
  }
  const limit = TIMED_LIMITS.maxStepS;
  const distanceM = calculateDistance(start.coords, target);
  const bearing = calculateBearing(start.coords, target);
  const turn = ((bearing - Number(heading) + 540) % 360) - 180;
  const instructions = [];
  let partial = false;
  if (distanceM > 0.01 && Math.abs(turn) > 0.01) {
    const durationS = Math.abs(turn) / Number(turn < 0 ? leftDps : rightDps);
    const turnLimit = Math.min(limit, TIMED_LIMITS.maxTurnS);
    instructions.push({ action: turn < 0 ? 'Pivot left' : 'Pivot right', durationS: Math.floor(Math.min(durationS, turnLimit) * 1000) / 1000 });
    partial = durationS > turnLimit;
  }
  if (!partial && distanceM > 0.01) {
    const durationS = distanceM / Number(forwardMps);
    instructions.push({ action: 'Forward', durationS: Math.floor(Math.min(durationS, limit) * 1000) / 1000 });
    partial = durationS > instructions[instructions.length - 1].durationS;
  }
  if (!instructions.every(instruction => Number.isFinite(instruction.durationS) && instruction.durationS >= TIMED_LIMITS.minStepS && instruction.durationS <= limit)) {
    return { error: 'A safe timed step must be at least 0.100 s. Reconfirm the position/heading or use manual RC repositioning.' };
  }
  return { instructions, distanceM, bearing, partial, totalS: instructions.reduce((sum, instruction) => sum + instruction.durationS, 0) };
}

export const hasSafetyHold = state => Boolean(state?.operatorReport || state?.firmwareFault);
const safetyHold = state => state.firmwareFault || state.operatorReport;
const invalidateNavigation = state => ({
  ...state, start: null, heading: null, arrival: null, sampleSaved: false,
  probeRetracted: false, movementAuthorized: false, execution: 'UNVERIFIED',
});

// Session memory retains local reports for their own mission. Only a confirmed
// physical condition or verified firmware fault follows unrelated missions.
export function createMissionHoldStore() {
  const reports = new Map();
  let confirmedOperatorReport = null;
  let firmwareFault = null;
  return {
    remember(state) {
      if (state.missionId === null || state.missionId === undefined) return;
      if (state.operatorReport && !state.operatorReport.confirmedPhysical) reports.set(String(state.missionId), state.operatorReport);
      else reports.delete(String(state.missionId));
      confirmedOperatorReport = state.operatorReport?.confirmedPhysical ? state.operatorReport : null;
      firmwareFault = state.firmwareFault;
    },
    restore(missionId) {
      return { operatorReport: confirmedOperatorReport || reports.get(String(missionId)) || null, firmwareFault };
    },
  };
}

export const initialSupervisedMission = () => ({
  missionId: null, hold: null, operatorReport: null, firmwareFault: null,
  phase: 'PLANNING', pinIndex: 0, completed: [], start: null, heading: null,
  arrival: null, sampleSaved: false, inspectionAt: null,
  // Radio evidence never changes execution/arrival/sample/probe state.
  transmitted: false, acknowledged: false, movementAuthorized: false,
  telemetryRestored: false,
  execution: 'UNVERIFIED', probeRetracted: false,
});

export function supervisedMissionReducer(state, event) {
  if (event.type === 'RESET') {
    const missionId = event.missionId ?? state.missionId;
    const next = {
      ...initialSupervisedMission(), missionId,
      operatorReport: state.operatorReport?.confirmedPhysical ? state.operatorReport
        : missionId === state.missionId ? state.operatorReport : event.savedSafety?.operatorReport ?? null,
      firmwareFault: state.firmwareFault || event.savedSafety?.firmwareFault || null,
    };
    return { ...next, hold: safetyHold(next), phase: hasSafetyHold(next) ? 'HELD' : 'PLANNING' };
  }
  if (event.type === 'CANCEL') {
    const next = invalidateNavigation({ ...state, operatorReport: state.operatorReport?.confirmedPhysical ? state.operatorReport : null });
    return { ...next, phase: 'CANCELLED', hold: safetyHold(next) };
  }
  if (event.type === 'RADIO_EVIDENCE') return { ...state, transmitted: Boolean(event.transmitted), acknowledged: Boolean(event.acknowledged), telemetryRestored: Boolean(event.telemetryRestored) };
  // Internal state-machine boundary only: no telemetry parser or wire grammar is
  // introduced here. A future validated firmware adapter must provide evidence.
  if (event.type === 'FIRMWARE_FAULT' && event.verified === true && event.faultId && event.reason) {
    const fault = { source: 'FIRMWARE_CONFIRMED', reason: event.reason, trigger: 'FIRMWARE_FAULT', faultId: event.faultId };
    return { ...invalidateNavigation(state), phase: state.phase === 'CANCELLED' ? 'CANCELLED' : 'HELD', firmwareFault: fault, hold: fault };
  }
  if (event.type === 'FIRMWARE_FAULT_CLEARED') {
    if (event.verified !== true || !state.firmwareFault || event.faultId !== state.firmwareFault.faultId) return state;
    const next = { ...invalidateNavigation(state), firmwareFault: null };
    return { ...next, hold: next.operatorReport || { source: 'WORKFLOW', trigger: 'FIRMWARE_FAULT_CLEARED', reason: 'Verified firmware clearance received; inspect the rover and prepare again.' } };
  }
  if (['CANCELLED', 'COMPLETE'].includes(state.phase)) return state;
  if (event.type === 'REPORT_OPERATOR_FAULT' && !state.operatorReport) {
    const report = { source: 'OPERATOR_REPORT', reason: event.reason || 'Operator reported a physical safety concern.', trigger: 'REPORT_OPERATOR_FAULT button', confirmedPhysical: false, reportedAt: event.now ?? Date.now() };
    return { ...invalidateNavigation(state), phase: 'HELD', operatorReport: report, hold: state.firmwareFault || report };
  }
  if (event.type === 'CONFIRM_OPERATOR_HAZARD' && state.operatorReport && !state.firmwareFault) {
    const report = { ...state.operatorReport, confirmedPhysical: true };
    return { ...state, operatorReport: report, hold: report };
  }
  if (event.type === 'REVIEW_OPERATOR_REPORT') {
    if (!state.operatorReport || state.firmwareFault || event.disarmed !== true || event.stationary !== true ||
        event.safe !== true || event.probeClear !== true ||
        !['ENTERED_IN_ERROR', 'PHYSICALLY_RESOLVED'].includes(event.resolution) ||
        (state.operatorReport.confirmedPhysical && event.resolution !== 'PHYSICALLY_RESOLVED')) return state;
    return { ...invalidateNavigation(state), operatorReport: null, hold: null, phase: 'PLANNING' };
  }
  if (hasSafetyHold(state)) return state;
  switch (event.type) {
    case 'BEGIN_UPLOAD':
      return state.phase === 'READY' && state.probeRetracted
        ? { ...state, phase: 'UPLOADING', transmitted: false, acknowledged: false, telemetryRestored: false, movementAuthorized: false } : state;
    case 'UPLOAD_READY':
      return state.phase === 'UPLOADING' && state.acknowledged && state.telemetryRestored
        ? { ...state, phase: 'AWAITING_START' } : state;
    case 'AUTHORIZE_TIMED_START':
      return state.phase === 'AWAITING_START' && state.acknowledged && state.telemetryRestored && state.probeRetracted &&
        event.freshNeutral === true && event.armedHold === true && event.holdToSemi === true
        ? { ...state, phase: 'EXECUTION_UNVERIFIED', movementAuthorized: true, start: null, heading: null, execution: 'UNVERIFIED' } : state;
    case 'UPLOAD_CLOSED': {
      if (!['UPLOADING', 'AWAITING_START'].includes(state.phase)) return state;
      const deliveryPossible = event.deliveryPossible || state.transmitted || state.acknowledged;
      return { ...invalidateNavigation(state), phase: deliveryPossible ? 'HELD' : 'PLANNING',
        hold: deliveryPossible ? { source: 'WORKFLOW', trigger: 'UPLOAD_CLOSED', reason: 'Upload guide closed without physical start confirmation; delivery or execution is unverified. Use RC HOLD/DISARM and inspect before preparing again.' } : null };
    }
    case 'INTERRUPT':
      return { ...invalidateNavigation(state), phase: 'HELD', hold: { source: 'WORKFLOW', trigger: 'INTERRUPT: receiver connection status', reason: event.reason || 'Desktop receiver unavailable during an active operation; execution is unverified.' } };
    case 'SELECT_PIN':
      return state.phase === 'PLANNING' && Number.isInteger(event.index) && event.index >= 0 && event.index < event.pinCount && !state.completed.includes(event.index)
        ? { ...state, pinIndex: event.index, start: null, heading: null } : state;
    case 'CONFIRM_START':
      return state.phase === 'PLANNING' && event.probeClear && validPosition(event.position, event.now) &&
        event.heading !== '' && event.heading !== null && Number.isFinite(Number(event.heading)) && Number(event.heading) >= 0 && Number(event.heading) < 360
        ? { ...state, phase: 'READY', start: event.position, heading: Number(event.heading), probeRetracted: true } : state;
    case 'MANUAL_TAKEOVER':
      return ['PLANNING', 'READY', 'INSPECTION', 'HELD'].includes(state.phase) && event.probeClear
        ? { ...state, phase: 'MANUAL', start: null, heading: null, arrival: null, sampleSaved: false, movementAuthorized: true, execution: 'UNVERIFIED', probeRetracted: true } : state;
    case 'INSPECT':
      return ['MANUAL', 'READY', 'EXECUTION_UNVERIFIED'].includes(state.phase) && event.stopped
        ? { ...state, phase: 'INSPECTION', inspectionAt: event.now ?? Date.now(), execution: 'UNVERIFIED', start: null, heading: null } : state;
    case 'ACCEPT_ARRIVAL':
      return state.phase === 'INSPECTION' && event.stopped && validPosition(event.position, event.now) && event.position.confirmedAt >= state.inspectionAt
        ? { ...state, phase: 'SAMPLING', arrival: event.position, probeRetracted: false } : state;
    case 'REPLAN':
      return ['READY', 'INSPECTION', 'HELD'].includes(state.phase)
        ? { ...invalidateNavigation(state), phase: 'PLANNING', hold: null } : state;
    case 'SAMPLE_SAVED':
      return state.phase === 'SAMPLING' ? { ...state, phase: 'RETRACT', sampleSaved: true } : state;
    case 'CONFIRM_RETRACTED': {
      if (state.phase !== 'RETRACT' || !state.sampleSaved || !event.retracted || !event.finished ||
          !Number.isInteger(event.pinCount) || event.pinCount <= state.pinIndex) return state;
      const completed = [...new Set([...state.completed, state.pinIndex])];
      const next = Array.from({ length: event.pinCount }, (_, index) => index).find(index => !completed.includes(index));
      return { ...state, completed, phase: next === undefined ? 'COMPLETE' : 'NEXT_LEG', probeRetracted: true, start: null, heading: null };
    }
    case 'AUTHORIZE_NEXT':
      return state.phase === 'NEXT_LEG' && state.probeRetracted && event.authorized &&
        Number.isInteger(event.index) && event.index >= 0 && event.index < event.pinCount && !state.completed.includes(event.index)
        ? { ...state, phase: 'PLANNING', pinIndex: event.index, arrival: null, sampleSaved: false, probeRetracted: false, movementAuthorized: false } : state;
    default: return state;
  }
}

// Measured columns are intentionally empty without fresh satellite coordinates.
// Estimates remain in session state; the existing schema has no provenance field.
export function sampleMeasuredCoordinates(data, receivedAt, now = Date.now()) {
  const gps = gpsPosition(data, receivedAt, now);
  return gps ? { lat: gps.coords[0], lng: gps.coords[1], coords: gps.coords } : { lat: null, lng: null, coords: null };
}
