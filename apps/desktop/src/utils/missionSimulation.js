// Pure simulation. No Tauri, serial, telemetry subscription, database, or motor API.
import { calculateDistance } from './geo.js';

const coordinate = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const positive = n => Number.isFinite(n) && n > 0;
const probability = n => Number.isFinite(n) && n > 0 && n <= 1;
const fresh = (signal, now, age) => signal?.valid === true && Number.isFinite(signal.observedAt)
  && signal.observedAt >= 0 && now >= signal.observedAt && now - signal.observedAt <= age;

export function createWaypointPlan(id, coordinates, {arrivalToleranceM = 3, requiredConfidence = 0.95,
  maxUncertaintyM = 1} = {}) {
  if (typeof id !== 'string' || !id.trim() || !Array.isArray(coordinates) || !coordinates.length
    || coordinates.length > 50 || !coordinates.every(coordinate) || !positive(arrivalToleranceM)
    || !probability(requiredConfidence) || !positive(maxUncertaintyM) || maxUncertaintyM > arrivalToleranceM) {
    throw new Error('Invalid waypoint plan or localization requirements.');
  }
  return Object.freeze({version:3, id, simulationOnly:true, waypoints:Object.freeze(coordinates.map((p, i) =>
    Object.freeze({id:`${id}:wp:${i + 1}`, coordinates:Object.freeze([...p]), arrivalToleranceM,
      requiredConfidence, maxUncertaintyM, samplingRequestId:`${id}:soil:${i + 1}`})))});
}

// Demonstration thresholds only; no values in this file are field calibration.
const defaults = Object.freeze({maxSensorAgeMs:300, maxGpsAgeMs:1000, maxDrAgeMs:300,
  maxDrDurationMs:5000, maxDrDistanceM:5, maxTiltDegrees:10,
  extensionTimeoutMs:3000, sampleTimeoutMs:8000, retractionTimeoutMs:4000});
const probePhases = ['DRIVE_STOPPED', 'PROBE_EXTENDING', 'SOIL_SAMPLING', 'PROBE_RETRACTING'];
const terminal = ['MISSION_COMPLETE', 'ABORTED', 'MANUAL_OVERRIDE'];

export class MissionSimulation {
  constructor(plan, config = {}) {
    // Revalidate and copy caller-owned plans, so route changes cannot mutate a run.
    this.plan = createWaypointPlan(plan.id, plan.waypoints.map(w => w.coordinates));
    this.plan = Object.freeze({...this.plan, waypoints:Object.freeze(plan.waypoints.map(w => {
      createWaypointPlan(plan.id, [w.coordinates], w);
      return Object.freeze({...w, coordinates:Object.freeze([...w.coordinates])});
    }))});
    const ids = this.plan.waypoints.flatMap(w => [w.id, w.samplingRequestId]);
    if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
      throw new Error('Waypoint and sampling request identifiers must be unique.');
    }
    this.config = {...defaults, ...config};
    if (!Object.values(this.config).every(positive)) throw new Error('Invalid simulation limits.');
    this.phase = 'MISSION_STAGED'; this.reason = 'SIMULATION_ONLY'; this.index = 0;
    this.enteredAt = 0; this.lastNow = -1; this.clearanceRequiredAt = -1;
    this.waypoints = plan.waypoints.map(w => ({id:w.id, arrival:'PENDING', sampling:'PENDING', completion:'PENDING'}));
    this.samples = []; this.localizationSource = null;
  }

  snapshot() {
    return {simulationOnly:true, physicalOutputs:{drive:false, extend:false, retract:false},
      phase:this.phase, reason:this.reason, index:this.index, localizationSource:this.localizationSource,
      waypoints:this.waypoints.map(w => ({...w})), samples:this.samples.map(s => ({...s, values:{...s.values}}))};
  }

  transition(phase, now, reason = null) {
    this.phase = phase; this.enteredAt = now; this.reason = reason;
  }

  clearance(input, now) {
    const c = input.clearance;
    return fresh(c, now, this.config.maxSensorAgeMs) && c.observedAt > this.clearanceRequiredAt
      && (c.mechanism === 'VALIDATED_RETRACTION_SENSOR'
        || (c.mechanism === 'SUPERVISED_CLEARANCE' && c.operatorApproved === true));
  }

  localization(input, now) {
    const w = this.plan.waypoints[this.index], c = this.config;
    const usable = (s, age) => fresh(s, now, age) && coordinate(s.position)
      && probability(s.confidence) && s.confidence >= w.requiredConfidence
      && Number.isFinite(s.uncertaintyM) && s.uncertaintyM >= 0 && s.uncertaintyM <= w.maxUncertaintyM;
    if (usable(input.gps, c.maxGpsAgeMs)) return {...input.gps, source:'GPS'};
    const dr = input.deadReckoning;
    if (usable(dr, c.maxDrAgeMs) && dr.calibrated === true && dr.source === 'ENCODER_IMU'
      && fresh(input.encoder, now, c.maxSensorAgeMs) && fresh(input.imu, now, c.maxSensorAgeMs)
      && Number.isFinite(dr.anchorAt) && dr.anchorAt >= 0 && dr.anchorAt <= dr.observedAt && now >= dr.anchorAt
      && now - dr.anchorAt <= c.maxDrDurationMs && Number.isFinite(dr.distanceSinceAnchorM)
      && dr.distanceSinceAnchorM >= 0 && dr.distanceSinceAnchorM <= c.maxDrDistanceM) return {...dr, source:'BOUNDED_DR'};
    return null;
  }

  step(now, input = {}, action = 'tick') {
    if (!Number.isFinite(now) || now < 0 || now < this.lastNow) throw new Error('Simulation clock must be monotonic.');
    this.lastNow = now;
    if (terminal.includes(this.phase)) return this.snapshot();
    const c = this.config, w = this.plan.waypoints[this.index], progress = this.waypoints[this.index];
    const stopped = fresh(input.drive, now, c.maxSensorAgeMs) && input.drive.stopped === true;
    const imuSafe = fresh(input.imu, now, c.maxSensorAgeMs) && Number.isFinite(input.imu.tiltDegrees)
      && Math.abs(input.imu.tiltDegrees) <= c.maxTiltDegrees;
    const hold = (reason, phase = 'HOLD_SAFETY') => { this.transition(phase, now, reason); return this.snapshot(); };
    if (action === 'abort' || action === 'manualOverride') {
      return hold(action === 'abort' ? 'OPERATOR_ABORT' : 'MANUAL_CONTROL', action === 'abort' ? 'ABORTED' : 'MANUAL_OVERRIDE');
    }
    if (action === 'pause') return hold('OPERATOR_PAUSE', 'PAUSED');
    if (['PAUSED', 'HOLD_SAFETY', 'HOLD_LOCALIZATION'].includes(this.phase)) {
      // No automatic recovery, including after a tilt fault clears.
      if (action === 'recover' && input.operatorApproved === true && stopped && imuSafe
        && this.clearance(input, now) && this.localization(input, now)) {
        this.transition(progress.sampling === 'VALID' ? 'RETRACTION_CONFIRMED' : 'MISSION_STAGED', now);
      }
      return this.snapshot();
    }
    if (this.phase === 'MISSION_STAGED') {
      if (action !== 'authorize' || input.operatorApproved !== true || input.calibrationValidated !== true) return this.snapshot();
      if (!stopped || !imuSafe || !this.clearance(input, now)) return hold('START_CLEARANCE_REQUIRED');
      if (!this.localization(input, now)) return hold('LOCALIZATION_UNAVAILABLE', 'HOLD_LOCALIZATION');
      this.transition('NAVIGATING', now); return this.snapshot();
    }
    if (this.phase === 'NAVIGATING') {
      const location = this.localization(input, now);
      this.localizationSource = location?.source || null;
      if (!location) return hold('LOCALIZATION_UNAVAILABLE', 'HOLD_LOCALIZATION');
      if (!this.clearance(input, now) || !fresh(input.encoder, now, c.maxSensorAgeMs)
        || !imuSafe || input.obstacleClear !== true) return hold('NAVIGATION_INTERLOCK');
      if (calculateDistance(location.position, w.coordinates) + location.uncertaintyM <= w.arrivalToleranceM) {
        progress.arrival = 'CONFIRMED'; this.transition('ARRIVAL_CONFIRMED', now);
      }
      return this.snapshot();
    }
    if (this.phase === 'ARRIVAL_CONFIRMED') {
      if (!imuSafe) return hold('UNSAFE_TILT_OR_STALE_IMU');
      if (stopped) this.transition('DRIVE_STOPPED', now);
      return this.snapshot();
    }
    if (probePhases.includes(this.phase) && (!stopped || !imuSafe)) return hold('UNSAFE_TILT_IMU_OR_DRIVE');
    if (this.phase === 'DRIVE_STOPPED') {
      const location = this.localization(input, now);
      if (!location) return hold('LOCALIZATION_UNAVAILABLE', 'HOLD_LOCALIZATION');
      if (calculateDistance(location.position, w.coordinates) + location.uncertaintyM > w.arrivalToleranceM) {
        return hold('ARRIVAL_NO_LONGER_CONFIRMED');
      }
      this.clearanceRequiredAt = now;
      progress.sampling = 'EXTENDING'; this.transition('PROBE_EXTENDING', now);
    } else if (this.phase === 'PROBE_EXTENDING') {
      if (now - this.enteredAt >= c.extensionTimeoutMs) return hold('EXTENSION_TIMEOUT');
      if (fresh(input.contact, now, c.maxSensorAgeMs) && input.contact.observedAt >= this.enteredAt) {
        progress.sampling = 'SAMPLING'; this.transition('SOIL_SAMPLING', now);
      }
    } else if (this.phase === 'SOIL_SAMPLING') {
      if (now - this.enteredAt >= c.sampleTimeoutMs) { progress.sampling = 'FAILED'; return hold('SOIL_SAMPLE_TIMEOUT'); }
      const s = input.sample, values = s?.values;
      const ranges = {ph:[0,14], moisture:[0,100], ec:[0,Infinity], nitrogen:[0,Infinity], phosphorus:[0,Infinity], potassium:[0,Infinity]};
      if (fresh(s, now, c.maxSensorAgeMs) && s.observedAt >= this.enteredAt && s.requestId === w.samplingRequestId
        && values && Object.entries(ranges).every(([key, [min,max]]) => Number.isFinite(values[key]) && values[key] >= min && values[key] <= max)) {
        this.samples.push({requestId:s.requestId, waypointId:w.id, values:{...values}});
        progress.sampling = 'VALID'; this.transition('PROBE_RETRACTING', now);
      }
    } else if (this.phase === 'PROBE_RETRACTING') {
      if (now - this.enteredAt >= c.retractionTimeoutMs) return hold('RETRACTION_UNCONFIRMED');
      if (this.clearance(input, now) && input.clearance.observedAt >= this.enteredAt) this.transition('RETRACTION_CONFIRMED', now);
    } else if (this.phase === 'RETRACTION_CONFIRMED') {
      if (!stopped || !imuSafe || !this.clearance(input, now)) return hold('CLEARANCE_REQUIRED');
      progress.completion = 'COMPLETE'; this.transition('NEXT_WAYPOINT', now);
    } else if (this.phase === 'NEXT_WAYPOINT') {
      if (this.index + 1 === this.plan.waypoints.length) this.transition('MISSION_COMPLETE', now);
      else { this.index += 1; this.transition('MISSION_STAGED', now, 'AUTHORIZE_NEXT_WAYPOINT'); }
    }
    return this.snapshot();
  }
}
