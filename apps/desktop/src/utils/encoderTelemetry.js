export const DEFAULT_ENCODER_STALE_MS = 3000;
export const ENCODER_UI_INTERVAL_MS = 100;

const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function encoderEventRejectionReason(data) {
  if (data?.type !== 'encoder') return 'expected_type_encoder';
  for (const key of ['encoderSeq', 'invalidL', 'invalidR', 'ageAtTransmitMs']) {
    if (!uint32(data[key])) return `${key}_must_be_uint32`;
  }
  for (const key of ['leftTicks', 'rightTicks']) {
    if (!Number.isSafeInteger(data[key])) return `${key}_must_be_safe_integer`;
  }
  for (const key of ['leftRPM', 'rightRPM']) {
    if (!finite(data[key])) return `${key}_must_be_finite_number`;
  }
  return Number.isSafeInteger(data.receivedAtMs) && data.receivedAtMs >= 0 ? null : 'invalid_receivedAtMs';
}
export const isEncoderEvent = data => encoderEventRejectionReason(data) === null;

export function fusionEventRejectionReason(data) {
  if (data?.type !== 'fusion') return 'expected_type_fusion';
  if (!uint32(data.fusionSeq)) return 'fusionSeq_must_be_uint32';
  if (data.encoderValid !== 0 && data.encoderValid !== 1) return 'encoderValid_must_be_0_or_1';
  if (data.encoderValid === 1) {
    if (!finite(data.leftRPM) || !finite(data.rightRPM)) return 'fusion_rpm_must_be_finite_numbers';
    if (!uint32(data.encoderAgeMs)) return 'encoderAgeMs_must_be_uint32';
  }
  return Number.isSafeInteger(data.receivedAtMs) && data.receivedAtMs >= 0 ? null : 'invalid_receivedAtMs';
}
export const isFusionRpmEvent = data => fusionEventRejectionReason(data) === null;

export function rpmDifferencePercent(leftRPM, rightRPM) {
  const left = Math.abs(leftRPM), right = Math.abs(rightRPM);
  const average = left / 2 + right / 2;
  return average > 0.1 ? (Math.abs(left - right) / average) * 100 : 0;
}

// RPM may already be normalized by newer firmware. Raw tick calibration in the
// checked-in Mega sketch does not establish the transmitted RPM sign convention.
export function rotationDirection(rpm) {
  if (rpm === 0) return 'Stopped';
  return rpm > 0 ? 'Positive rotation (+)' : 'Negative rotation (−)';
}

// Native receipt time includes coalescing/IPC delay. Subsequent elapsed time uses
// a monotonic clock so desktop wall-clock adjustments do not revive old readings.
function createMeasurementMonitor({ clock = () => performance.now(), wallClock = () => Date.now(), validate, reportedAge }) {
  let packet = null, acceptedAt = 0, deliveryAge = 0;
  return {
    accept(data) {
      if (!validate(data)) return false;
      packet = { ...data };
      acceptedAt = clock();
      deliveryAge = Math.max(0, wallClock() - data.receivedAtMs);
      return true;
    },
    reset() { packet = null; },
    snapshot(connected, staleAfterMs = DEFAULT_ENCODER_STALE_MS) {
      const sincePacketMs = packet ? deliveryAge + Math.max(0, clock() - acceptedAt) : null;
      const minimumAgeMs = packet ? reportedAge(packet) + sincePacketMs : null;
      const state = !connected ? 'unavailable' : !packet ? 'no-data'
        : minimumAgeMs >= staleAfterMs ? 'stale' : 'receiving';
      return { packet, sincePacketMs, minimumAgeMs, state };
    },
  };
}

export const createEncoderMonitor = (options = {}) => createMeasurementMonitor({
  ...options, validate: isEncoderEvent, reportedAge: packet => packet.ageAtTransmitMs,
});
export const createFusionRpmMonitor = (options = {}) => createMeasurementMonitor({
  ...options, validate: data => isFusionRpmEvent(data) && data.encoderValid === 1,
  reportedAge: packet => packet.encoderAgeMs,
});
