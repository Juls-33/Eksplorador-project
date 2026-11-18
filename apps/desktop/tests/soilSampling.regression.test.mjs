// MTP-SW-03 - Soil Sampling State and Telemetry Data Handling
// Run from Eksplorador-project root:
// node --test --test-name-pattern="SW03-STEP1" .\apps\desktop\tests\soilSampling.regression.test.mjs
// node --test --test-name-pattern="SW03-STEP2" .\apps\desktop\tests\soilSampling.regression.test.mjs
// node --test .\apps\desktop\tests\soilSampling.regression.test.mjs
// Imports the actual application utility. Does not access SQLite.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOIL_LEAD_IN_MS,
  SOIL_OBSERVATION_MS,
  MIN_AVERAGE_READINGS,
  summarizeSoilSession,
  samplingPhase,
  recordUniqueSoilReading,
} from '../src/utils/soilSampling.js';

const startedAt = 1_000_000;
const values = (moisture, ph, ec, nitrogen, phosphorus, potassium) => ({
  moisture, ph, ec, nitrogen, phosphorus, potassium,
});
const reading = (elapsedMs, data) => ({ receivedAt: startedAt + elapsedMs, data });

const simulatedReadings = [
  reading(4_999, values(99, 3, 9999, 99, 99, 99)),
  reading(5_000, values(10, 6, 100, 30, 20, 10)),
  reading(150_000, values(20, 7, 200, 40, 30, 20)),
  reading(304_999, values(30, 8, 300, 50, 40, 30)),
  reading(305_001, values(99, 3, 9999, 99, 99, 99)),
];

const session = {
  startedAt,
  lastSeen: startedAt + 304_999,
  completed: false,
  readings: simulatedReadings,
};

test('SW03-STEP1A: simulated 5 s lead-in and 300 s observation transitions', () => {
  assert.equal(SOIL_LEAD_IN_MS, 5_000);
  assert.equal(SOIL_OBSERVATION_MS, 305_000);
  assert.equal(MIN_AVERAGE_READINGS, 3);
  assert.deepEqual(samplingPhase(session, startedAt), { phase: 'lead-in', remainingMs: 5_000 });
  assert.deepEqual(samplingPhase(session, startedAt + 4_999), { phase: 'lead-in', remainingMs: 1 });
  assert.deepEqual(samplingPhase(session, startedAt + 5_000), { phase: 'observing', remainingMs: 300_000 });
  assert.deepEqual(samplingPhase(session, startedAt + 304_999), { phase: 'observing', remainingMs: 1 });
  assert.deepEqual(samplingPhase(session, startedAt + 305_000), { phase: 'finalize', remainingMs: 0 });
  assert.deepEqual(samplingPhase({ ...session, completed: true }, startedAt + 305_000), { phase: 'ready', remainingMs: 0 });
  console.log('  lead-in 0-5 s; observation 5-305 s; eligible session -> finalize');
});

test('SW03-STEP1B: only eligible readings contribute to each arithmetic mean', () => {
  const actual = summarizeSoilSession(simulatedReadings, startedAt);
  assert.equal(actual.totalRaw, 5);
  assert.equal(actual.count, 3);
  const expected = { moisture: 20, ph: 7, ec: 200, nitrogen: 40, phosphorus: 30, potassium: 20 };
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(actual[field], value, `${field} must equal the mean of the three eligible packets`);
  }
  console.log(`  raw=${actual.totalRaw}; eligible=${actual.count}; averages=${JSON.stringify(expected)}`);
});

test('SW03-STEP1C: completed acquisition requires recently received telemetry', () => {
  const staleSession = { ...session, lastSeen: startedAt + 270_000 };
  assert.equal(samplingPhase(staleSession, startedAt + 305_000).phase, 'stale');
  assert.equal(samplingPhase(session, startedAt + 305_000).phase, 'finalize');
  console.log('  stale lastSeen -> stale; fresh lastSeen -> finalize');
});

test('SW03-STEP2A: fewer than three eligible readings cannot finalize', () => {
  const readings = [
    reading(6_000, values(20, 6, 100, 10, 20, 30)),
    reading(304_000, values(30, 7, 200, 20, 30, 40)),
  ];
  const result = summarizeSoilSession(readings, startedAt);
  assert.equal(result.count, 2);
  const phase = samplingPhase({
    startedAt, lastSeen: startedAt + 304_000, completed: false, readings,
  }, startedAt + SOIL_OBSERVATION_MS);
  assert.equal(phase.phase, 'insufficient');
  console.log(`  eligible=${result.count}; phase=${phase.phase}`);
});

test('SW03-STEP2B: invalid moisture, pH and EC readings are excluded', () => {
  const readings = [
    reading(6_000, values(20, 6, 100, 10, 20, 30)),
    reading(7_000, values(-1, 6, 100, 10, 20, 30)),
    reading(8_000, values(101, 6, 100, 10, 20, 30)),
    reading(9_000, values(20, 15, 100, 10, 20, 30)),
    reading(10_000, values(20, null, 100, 10, 20, 30)),
    reading(11_000, values(20, 6, -1, 10, 20, 30)),
    reading(12_000, values(20, 6, 'bad', 10, 20, 30)),
    reading(13_000, values(40, 8, 300, 30, 40, 50)),
  ];
  const result = summarizeSoilSession(readings, startedAt);
  assert.equal(result.totalRaw, 8);
  assert.equal(result.count, 2);
  assert.equal(result.moisture, 30);
  assert.equal(result.ph, 7);
  assert.equal(result.ec, 200);
  console.log(`  raw=${result.totalRaw}; eligible=${result.count}; moisture=${result.moisture}, pH=${result.ph}, EC=${result.ec}`);
});

test('SW03-STEP2C: missing NPK measurements are omitted, not averaged as zero', () => {
  const readings = [
    reading(6_000, values(10, 6, 100, 10, null, undefined)),
    reading(7_000, values(20, 7, 200, null, 30, undefined)),
    reading(8_000, values(30, 8, 300, 30, undefined, undefined)),
  ];
  const result = summarizeSoilSession(readings, startedAt);
  assert.equal(result.count, 3);
  assert.equal(result.moisture, 20);
  assert.equal(result.ph, 7);
  assert.equal(result.ec, 200);
  assert.equal(result.nitrogen, 20);
  assert.equal(result.phosphorus, 30);
  assert.equal(result.potassium, null);
  console.log(`  eligible=${result.count}; N=${result.nitrogen}, P=${result.phosphorus}, K=${result.potassium}`);
});

test('SW03-STEP2D: invalid-only stream remains insufficient', () => {
  const readings = [
    reading(6_000, values(null, 7, 100, 10, 20, 30)),
    reading(7_000, values(20, 99, 100, 10, 20, 30)),
    reading(304_000, values(20, 7, -5, 10, 20, 30)),
  ];
  const result = summarizeSoilSession(readings, startedAt);
  assert.equal(result.count, 0);
  for (const field of ['moisture', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium']) {
    assert.equal(result[field], null);
  }
  const phase = samplingPhase({
    startedAt, lastSeen: startedAt + 304_000, completed: false, readings,
  }, startedAt + SOIL_OBSERVATION_MS);
  assert.equal(phase.phase, 'insufficient');
  console.log(`  raw=${result.totalRaw}; eligible=0; phase=${phase.phase}`);
});


// Step 3: exercised against the exported application helper, not a test-only implementation.
const seqReading = (elapsedMs, seq, moisture = 20) =>
  reading(elapsedMs, { ...values(moisture, 6.5, 100, 10, 20, 30), seq });
const newSequenceSession = () => ({ startedAt, lastSeen: startedAt, completed: false, readings: [] });

test('SW03-STEP3A: retransmitted sequence is excluded from the five-minute mean', () => {
  const s = newSequenceSession();
  assert.equal(recordUniqueSoilReading(s, seqReading(6_000, 101, 20)), true);
  assert.equal(recordUniqueSoilReading(s, seqReading(7_000, 102, 30)), true);
  assert.equal(recordUniqueSoilReading(s, seqReading(8_000, 102, 30)), false);
  assert.equal(recordUniqueSoilReading(s, seqReading(9_000, 103, 60)), true);
  assert.equal(s.readings.length, 3);
  assert.equal(summarizeSoilSession(s.readings, startedAt).moisture, 110 / 3);
  console.log('  4 arrivals -> 3 unique readings; moisture mean=36.666...');
});

test('SW03-STEP3B: different sequence IDs with identical sensor values remain independent', () => {
  const s = newSequenceSession();
  for (const [i, seq] of [201, 202, 203].entries()) {
    assert.equal(recordUniqueSoilReading(s, seqReading(6_000 + i * 1_000, seq, 25)), true);
  }
  assert.equal(s.readings.length, 3);
  assert.equal(summarizeSoilSession(s.readings, startedAt).count, 3);
  assert.equal(summarizeSoilSession(s.readings, startedAt).moisture, 25);
});

test('SW03-STEP3C: older out-of-order packet cannot alter mean or refresh freshness', () => {
  const s = newSequenceSession();
  recordUniqueSoilReading(s, seqReading(6_000, 301, 10));
  recordUniqueSoilReading(s, seqReading(7_000, 303, 30));
  const seenAt = s.lastSeen;
  assert.equal(recordUniqueSoilReading(s, seqReading(304_999, 302, 90)), false);
  assert.equal(s.lastSeen, seenAt);
  assert.equal(s.readings.length, 2);
  assert.equal(samplingPhase(s, startedAt + 305_000).phase, 'stale');
});

test('SW03-STEP3D: a packet arriving after the 300-second observation is not averaged', () => {
  const s = newSequenceSession();
  for (const [i, v] of [10, 20, 30].entries()) {
    recordUniqueSoilReading(s, seqReading(6_000 + i * 1_000, 401 + i, v));
  }
  recordUniqueSoilReading(s, seqReading(305_001, 404, 100));
  const summary = summarizeSoilSession(s.readings, startedAt);
  assert.equal(summary.totalRaw, 4);
  assert.equal(summary.count, 3);
  assert.equal(summary.moisture, 20);
});

test('SW03-STEP3E: a new insertion owns fresh sequence tracking', () => {
  const old = newSequenceSession();
  recordUniqueSoilReading(old, seqReading(6_000, 500, 20));
  // Simulate cancellation/probe lift by discarding the old session and creating a new one.
  const restarted = newSequenceSession();
  assert.equal(recordUniqueSoilReading(restarted, seqReading(6_000, 500, 40)), true);
  assert.equal(restarted.readings.length, 1);
  assert.equal(old.readings.length, 1);
});

test('SW03-STEP3F: retransmissions cannot satisfy the minimum three unique readings', () => {
  const s = newSequenceSession();
  recordUniqueSoilReading(s, seqReading(6_000, 700, 20));
  recordUniqueSoilReading(s, seqReading(7_000, 700, 20));
  recordUniqueSoilReading(s, seqReading(304_000, 700, 20));
  assert.equal(s.readings.length, 1);
  assert.equal(samplingPhase(s, startedAt + SOIL_OBSERVATION_MS).phase, 'stale');
  // Distinguish duplicate detection from insufficient data, when telemetry remains fresh.
  s.lastSeen = startedAt + 304_000;
  assert.equal(samplingPhase(s, startedAt + SOIL_OBSERVATION_MS).phase, 'insufficient');
});

test('SW03-STEP3G: 32-bit sequence wraps forward without accepting stale sequence', () => {
  const s = newSequenceSession();
  assert.equal(recordUniqueSoilReading(s, seqReading(6_000, 0xFFFFFFFE, 20)), true);
  assert.equal(recordUniqueSoilReading(s, seqReading(7_000, 0xFFFFFFFF, 30)), true);
  assert.equal(recordUniqueSoilReading(s, seqReading(8_000, 0, 40)), true);
  assert.equal(recordUniqueSoilReading(s, seqReading(9_000, 0xFFFFFFFF, 99)), false);
  assert.equal(s.readings.length, 3);
});
