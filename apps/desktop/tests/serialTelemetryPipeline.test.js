import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEncoderTelemetryStore } from '../src/services/encoderTelemetryStore.js';

// Replay uses the actual native framing/classifier/sequence filters, then sends
// their serialized events into the actual shared store. No JS parser substitute,
// serial hardware, application database or wall-clock sleeps are involved.
const nativeRoot = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const replay = name => {
  const fixture = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const result = spawnSync('cargo', ['run', '--offline', '--quiet', '--example', 'replay_telemetry', '--', fixture], {
    cwd: nativeRoot, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, EKSPLORADOR_TELEMETRY_DEBUG: '1' }, windowsHide: true,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return { frames: result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line)), diagnostics: result.stderr };
};
let mixed, actual;
before(() => {
  mixed = replay('mixed-fusion-stream.jsonl');
  actual = replay('actual-a27-receiver.log');
});

const setup = async () => {
  let now = 0, tick;
  const handlers = new Map(), diagnostics = [];
  const store = createEncoderTelemetryStore({
    clock: () => now, wallClock: () => 10000 + now,
    listen: async (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
    schedule: fn => { tick = fn; return fn; }, cancel() {},
    diagnostic: (stage, details) => diagnostics.push({ stage, ...details }),
  });
  const stop = store.start();
  store.setReceiver({ connected: true, port: 'replay', connectionError: null });
  await new Promise(resolve => setImmediate(resolve));
  return { store, stop, diagnostics,
    feed(frame, include = () => true) {
      now = frame.elapsedMs;
      for (const event of frame.events) if (include(event)) handlers.get(event.event)?.({ payload: event.payload });
      tick();
    },
    advance(ms) { now += ms; tick(); },
  };
};

test('alternating DATA/ENC/FUS, diagnostics and malformed JSON advance real encoder sequences/RPM without becoming stale', async () => {
  const env = await setup();
  const sequences = [], speeds = [];
  let lastPacket = null;
  for (const frame of mixed.frames) {
    env.feed(frame);
    const snapshot = env.store.getSnapshot();
    const encoder = frame.events.find(event => event.event === 'encoder-data');
    if (encoder) {
      sequences.push(snapshot.packet.encoderSeq);
      speeds.push(snapshot.rpmPacket.leftRPM);
      lastPacket = snapshot.packet;
    } else assert.strictEqual(snapshot.packet, lastPacket, 'Fusion/sensor traffic cannot replace counters');
    assert.equal(snapshot.state, 'receiving', `at ${frame.elapsedMs}ms`);
    assert.equal(snapshot.rpmSource, 'encoder');
  }
  assert.deepEqual(sequences, [170, 171, 172, 173, 174, 175, 176]);
  assert.deepEqual(speeds, [0, 20, -44.97, -30, 35, 45, 50]);
  for (const stage of ['raw', 'json_parsed', 'classified', 'encoder_updated', 'encoder_emitted', 'rejected']) {
    assert.ok(mixed.diagnostics.includes(`[telemetry:${stage}]`), stage);
  }
  assert.match(mixed.diagnostics, /classified\] fusion/);
  assert.match(mixed.diagnostics, /invalid_json/);
  assert.match(mixed.diagnostics, /invalid_encoder/);
  assert.ok(env.diagnostics.some(item => item.stage === 'encoder_state_updated'));
  env.stop();
});

test('actual receiver capture supplies fresh zero RPM through fusion and never fabricates missing ENC counters', async () => {
  const env = await setup();
  for (const frame of actual.frames) env.feed(frame);
  const snapshot = env.store.getSnapshot();
  assert.equal(snapshot.state, 'receiving');
  assert.equal(snapshot.rpmSource, 'fusion');
  assert.equal(snapshot.rpmPacket.fusionSeq, 912, 'RAW RX FUS:913 is not a second JSON measurement');
  assert.equal(snapshot.rpmPacket.leftRPM, 0);
  assert.equal(snapshot.rpmPacket.rightRPM, 0);
  assert.equal(snapshot.rpmMinimumAgeMs, 987);
  assert.equal(snapshot.packet, null);
  assert.equal(snapshot.encoderState, 'no-data');
  assert.equal(snapshot.rpmPacket.leftTicks, undefined);
  assert.equal(snapshot.rpmPacket.encoderSeq, undefined);
  const events = actual.frames.flatMap(frame => frame.events);
  assert.deepEqual(events.filter(event => event.event === 'sensor-data').map(event => event.payload.seq), [913, 914]);
  assert.equal(events.filter(event => event.event === 'encoder-data').length, 0);
  assert.equal(events.filter(event => event.event === 'fusion-data').length, 1);
  env.advance(2013); // 237 reported + 750 previous elapsed + 2013 = 3000 ms.
  assert.equal(env.store.getSnapshot().state, 'stale');
  env.stop();
});

test('genuine absence of both RPM sources becomes stale while DATA continues normally', async () => {
  const env = await setup();
  let sawEncoder = false;
  for (const frame of mixed.frames) env.feed(frame, event => {
    if (event.event === 'fusion-data') return false;
    if (event.event !== 'encoder-data') return true;
    if (sawEncoder) return false;
    sawEncoder = true;
    return true;
  });
  const snapshot = env.store.getSnapshot();
  assert.equal(snapshot.state, 'stale');
  assert.equal(snapshot.encoderState, 'stale');
  assert.equal(snapshot.packet.encoderSeq, 170);
  assert.ok(snapshot.minimumAgeMs > 3000);
  env.stop();
});

test('continued valid FUS can keep only RPM live when standalone ENC genuinely disappears', async () => {
  const env = await setup();
  let sawEncoder = false;
  for (const frame of mixed.frames) env.feed(frame, event => {
    if (event.event !== 'encoder-data') return true;
    if (sawEncoder) return false;
    sawEncoder = true;
    return true;
  });
  const snapshot = env.store.getSnapshot();
  assert.equal(snapshot.state, 'receiving');
  assert.equal(snapshot.encoderState, 'stale');
  assert.equal(snapshot.rpmSource, 'fusion');
  assert.equal(snapshot.rpmPacket.fusionSeq, 917);
  assert.equal(snapshot.packet.encoderSeq, 170);
  assert.equal(snapshot.packet.leftTicks, 0);
  assert.ok(snapshot.minimumAgeMs > 3000);
  env.stop();
});
