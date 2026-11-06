export const TIMED_LIMITS = Object.freeze({ minStepS: 0.1, maxStepS: 2, maxTurnS: 1.5, maxLegS: 4, maxTokens: 2, maxSequenceBytes: 226 });

// Validate the supplied bytes without trimming, rounding, truncating or accepting
// legacy distance/angle, reverse or actuator instructions. Decimal comparisons
// use integers so excess precision cannot round an out-of-range token into range.
export function validateTimedLeg(sequence) {
  const fail = error => ({ error });
  if (typeof sequence !== 'string' || !sequence || new TextEncoder().encode(sequence).length > TIMED_LIMITS.maxSequenceBytes) {
    return fail('Timed leg must fit the 226-byte Mission V2 sequence limit.');
  }
  const tokens = sequence.split(',');
  if (tokens.length < 1 || tokens.length > 2) return fail('Upload exactly one or two timed movement tokens.');
  const parsed = [];
  for (const token of tokens) {
    const match = /^T([FLR])([0-9]+(?:\.[0-9]+)?)$/.exec(token);
    if (!match || match[0] !== token) return fail('Use only TF/TL/TR followed by ASCII seconds; no spaces, legacy, reverse or actuator commands.');
    const [whole, fraction = ''] = match[2].split('.');
    const scale = 10n ** BigInt(fraction.length);
    const value = BigInt(whole + fraction);
    if (value * 1000n < 100n * scale || value * 1000n > 2000n * scale ||
        (match[1] !== 'F' && value * 1000n > 1500n * scale)) {
      return fail('Each step must be 0.100–2.000 s; pivots must not exceed 1.500 s.');
    }
    parsed.push({ action: match[1], durationS: Number(match[2]), value, scale, precision: fraction.length });
  }
  const precision = Math.max(...parsed.map(step => step.precision));
  const scale = 10n ** BigInt(precision);
  const total = parsed.reduce((sum, step) => sum + step.value * (scale / step.scale), 0n);
  if (total > 4n * scale) return fail('Timed leg exceeds 4.000 seconds.');
  return { instructions: parsed.map(({ action, durationS }) => ({ action, durationS })), totalS: Number(total) / Number(scale) };
}

export function serializeTimedLeg(instructions) {
  if (!Array.isArray(instructions) || instructions.length < 1 || instructions.length > 2) throw new Error('Upload exactly one or two timed movement instructions.');
  const actions = { Forward: 'F', 'Pivot left': 'L', 'Pivot right': 'R' };
  const sequence = instructions.map(step => {
    const action = actions[step.action];
    if (!action || typeof step.durationS !== 'number' || !Number.isFinite(step.durationS)) throw new Error('Unsupported timed movement instruction.');
    // Planning explicitly produces millisecond durations. Never repair an
    // arbitrary invalid instruction by rounding it into the firmware limits.
    const raw = `T${action}${step.durationS}`;
    const checked = validateTimedLeg(raw);
    if (checked.error || Number(step.durationS.toFixed(3)) !== step.durationS) {
      throw new Error(checked.error || 'Timed instruction must use whole milliseconds.');
    }
    return `T${action}${step.durationS.toFixed(3)}`;
  }).join(',');
  const checked = validateTimedLeg(sequence);
  if (checked.error) throw new Error(checked.error);
  return sequence;
}
