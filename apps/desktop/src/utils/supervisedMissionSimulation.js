import { compareWaypointGps, requireFreshGps, validateSequence } from './missionPlanning.js';

// Hardware-free A3.0 model. No serial, motor, sampling, or database outputs.
// Thresholds are illustrative test limits, never firmware calibration values.
export class SupervisedMissionSimulation {
  constructor(plan, {maxStepMs = 5000, maxSensorAgeMs = 500, checkpointRadiusM = 3} = {}) {
    this.plan = JSON.parse(JSON.stringify(plan));
    this.tokens = validateSequence(plan.sequence);
    if (![maxStepMs, maxSensorAgeMs, checkpointRadiusM].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid simulation limits.');
    this.config = {maxStepMs, maxSensorAgeMs, checkpointRadiusM};
    this.phase = 'STAGED'; this.reason = null; this.index = 0; this.lastNow = -1;
    this.enteredAt = 0; this.holdSeen = false; this.arrivals = []; this.completedSteps = [];
  }
  snapshot() {
    const step = ['STAGED','WAIT_CALIBRATION','WAIT_RC_AUTH'].includes(this.phase) ? 0 : Math.min(this.index + 1, this.tokens.length);
    const states = {RUNNING_ENCODER:'RUNNING', STEP_COMPLETE:'STEP_DONE', GPS_WAYPOINT_VERIFIED:'PIN_CHECKED',
      HOLD_LOCALIZATION:'HOLD',HOLD_OBSTACLE:'HOLD',HOLD_SAFETY:'HOLD',WAIT_CALIBRATION:'STAGED',WAIT_RC_AUTH:'STAGED'};
    return {simulationOnly:true, physicalOutputs:{drive:false, extend:false, retract:false},
      phase:this.phase, reason:this.reason, index:this.index, step, report:{state:states[this.phase] || this.phase, step}, token:this.tokens[this.index] ?? null,
      arrivals:this.arrivals.map(s => ({...s})), completedSteps:[...this.completedSteps]};
  }
  step(now, input = {}, action = 'tick') {
    if (!Number.isFinite(now) || now < 0 || now < this.lastNow) throw new Error('Simulation clock must be monotonic.');
    this.lastNow = now;
    const transition = (phase, reason = null) => {this.phase = phase; this.reason = reason; this.enteredAt = now; return this.snapshot();};
    if (['COMPLETE','CANCELLED','MANUAL_OVERRIDE','FAULT'].includes(this.phase)) return this.snapshot();
    if (action === 'cancel') return transition('CANCELLED', 'OPERATOR_CANCEL');
    const fresh = signal => signal?.valid === true && Number.isFinite(signal.observedAt)
      && signal.observedAt <= now && now - signal.observedAt <= this.config.maxSensorAgeMs;
    const rc = input.rc;
    if (fresh(rc) && rc.mode === 'MANUAL') return transition('MANUAL_OVERRIDE', 'MANUAL_TAKEOVER');
    const authorized = fresh(rc) && rc.authorized === true;
    if (['RUNNING_ENCODER','STEP_COMPLETE','GPS_WAYPOINT_VERIFIED'].includes(this.phase) && !authorized) return transition('HOLD_SAFETY', 'RC_DISCONNECTED');
    if (['HOLD_OBSTACLE','HOLD_SAFETY','HOLD_LOCALIZATION'].includes(this.phase)) return this.snapshot(); // Mega clears mission on HOLD. Stage a new mission; never auto-resume.
    let gpsFresh = false;
    try { requireFreshGps(input.gps, now); gpsFresh = true; } catch { /* GPS loss alone is not a critical fault. */ }
    if (['STAGED','WAIT_CALIBRATION','WAIT_RC_AUTH'].includes(this.phase)) {
      if (input.encoderCalibrated !== true || input.turnCalibrated !== true) return transition('WAIT_CALIBRATION', 'NOT_CALIBRATED');
      if (authorized && rc.mode === 'HOLD') this.holdSeen = true;
      if (!authorized) this.holdSeen = false;
      if (!authorized || !this.holdSeen || rc.mode !== 'SEMI_AUTO') return transition('WAIT_RC_AUTH', 'DELIBERATE_TRANSITION_REQUIRED');
      this.holdSeen = false;
      if (!gpsFresh) return transition('HOLD_LOCALIZATION', 'GPS_UNVERIFIED');
      return this.enterToken(now, input, transition);
    }
    if (rc.mode !== 'SEMI_AUTO') return transition('HOLD_SAFETY', 'RC_HOLD');
    if (this.phase === 'RUNNING_ENCODER') {
      if (this.tokens[this.index][0] === 'F' && input.forwardObstacle === true) return transition('HOLD_OBSTACLE', 'FORWARD_OBSTACLE');
      if (now - this.enteredAt > this.config.maxStepMs) return transition('FAULT', 'ENCODER_TARGET_TIMEOUT');
      if (!fresh(input.encoder)) return transition('HOLD_SAFETY', 'ENCODER_UNAVAILABLE');
      if (input.encoder.step === this.index + 1 && input.encoder.observedAt >= this.enteredAt && input.encoder.targetReached === true) {
        this.completedSteps.push(this.index + 1);
        return transition('STEP_COMPLETE', 'ENCODER_TARGET');
      }
      return this.snapshot(); // GPS interruption cannot by itself stop this bounded segment.
    }
    if (['STEP_COMPLETE','GPS_WAYPOINT_VERIFIED'].includes(this.phase)) {
      this.index += 1;
      if (this.index === this.tokens.length) return transition('COMPLETE', 'ESTIMATED_ROUTE');
      if (!gpsFresh) return transition('HOLD_LOCALIZATION', 'GPS_UNVERIFIED');
      return this.enterToken(now, input, transition);
    }
    return this.snapshot();
  }
  enterToken(now, input, transition) {
    const token = this.tokens[this.index];
    if (token[0] === 'W') {
      const [a, b] = token.slice(1).split('.').map(Number);
      const expected = [a / 1e6 - 90, b / 1e6 - 180];
      const result = compareWaypointGps(expected, input.gps, now, this.config.checkpointRadiusM);
      if (result.result !== 'WITHIN_COMPARISON_RADIUS') return transition('HOLD_LOCALIZATION', result.result === 'GPS_UNVERIFIED' ? 'GPS_UNVERIFIED' : 'MISSED_CHECKPOINT');
      this.arrivals.push({step:this.index + 1, expected, distanceM:result.distanceM});
      return transition('GPS_WAYPOINT_VERIFIED', 'GPS_CHECKPOINT');
    }
    if (token[0] === 'F' && input.forwardObstacle === true) return transition('HOLD_OBSTACLE', 'FORWARD_OBSTACLE');
    if (input.encoder?.valid !== true || !Number.isFinite(input.encoder.observedAt)
      || input.encoder.observedAt > now || now - input.encoder.observedAt > this.config.maxSensorAgeMs) return transition('HOLD_SAFETY', 'ENCODER_UNAVAILABLE');
    return transition('RUNNING_ENCODER');
  }
}
