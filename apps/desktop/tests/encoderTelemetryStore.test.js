import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEncoderTelemetryStore, ENCODER_HISTORY_LIMIT, ENCODER_HISTORY_MS } from '../src/services/encoderTelemetryStore.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const connected = { connected: true, port: 'mock-receiver', connectionError: null };
const packet = overrides => ({ type: 'encoder', encoderSeq: 172, leftTicks: -13501, rightTicks: 13278,
  leftRPM: -44.97, rightRPM: -44.65, invalidL: 1, invalidR: 2, ageAtTransmitMs: 100, ...overrides });

async function setup() {
  let now = 0, tick, registrations = 0, removals = 0;
  const handlers = new Map();
  const store = createEncoderTelemetryStore({
    clock: () => now, wallClock: () => 10000 + now,
    listen: async (name, receive) => {
      assert.ok(['encoder-data', 'fusion-data'].includes(name));
      if (name === 'encoder-data') registrations += 1;
      handlers.set(name, receive);
      return () => { if (name === 'encoder-data') removals += 1; handlers.delete(name); };
    },
    schedule(fn, delay) { assert.equal(delay, 100); tick = fn; return fn; },
    cancel(fn) { assert.equal(fn, tick); tick = null; },
  });
  const stop = store.start();
  store.setReceiver(connected);
  await flush();
  return { store, stop,
    emit(overrides = {}) { handlers.get('encoder-data')({ payload: packet({ receivedAtMs: 10000 + now, ...overrides }) }); },
    emitFusion(overrides = {}) { handlers.get('fusion-data')({ payload: { type: 'fusion', fusionSeq: 912, encoderValid: 1,
      leftRPM: 12, rightRPM: 13, encoderAgeMs: 237, receivedAtMs: 10000 + now, ...overrides } }); },
    advance(ms) { now += ms; tick(); },
    counts: () => ({ registrations, removals }),
  };
}

test('both views receive the exact same cached snapshot through one app-owned listener', async () => {
  const env = await setup();
  const snapshots = [[], []];
  const offMap = env.store.subscribe(() => snapshots[0].push(env.store.getSnapshot()));
  const offDashboard = env.store.subscribe(() => snapshots[1].push(env.store.getSnapshot()));
  env.store.start()(); // An extra owner attempt cannot open or stop a second listener.
  env.emit();
  assert.equal(snapshots[0].length, 0, 'Event callback must not repaint views immediately');
  env.advance(100);
  assert.strictEqual(snapshots[0][0], snapshots[1][0]);
  assert.strictEqual(env.store.getSnapshot(), env.store.getSnapshot());
  assert.equal(snapshots[0][0].state, 'receiving');
  assert.equal(snapshots[0][0].packet.leftRPM, -44.97);
  assert.deepEqual(env.counts(), { registrations: 1, removals: 0 });
  offMap(); offDashboard(); env.stop();
  assert.deepEqual(env.counts(), { registrations: 1, removals: 1 });
});

test('navigation preserves packets, history, shared timeout and freshness while no card is mounted', async () => {
  const env = await setup();
  const off = env.store.subscribe(() => {});
  env.emit(); env.advance(100);
  const accepted = env.store.getSnapshot().packet;
  env.store.setStaleAfterMs(5000);
  off();
  env.advance(4000);
  assert.equal(env.store.getSnapshot().state, 'receiving');
  assert.equal(env.store.getSnapshot().staleAfterMs, 5000);
  assert.strictEqual(env.store.getSnapshot().packet, accepted);
  assert.equal(env.store.getSnapshot().history.length, 1);
  env.advance(1000);
  assert.equal(env.store.getSnapshot().state, 'stale');
  // Packets also arrive while another, non-monitoring route is visible.
  env.emit({ encoderSeq: 173, leftRPM: 30 }); env.advance(100);
  assert.equal(env.store.getSnapshot().packet.encoderSeq, 173);
  assert.equal(env.store.getSnapshot().state, 'receiving');
  assert.equal(env.store.getSnapshot().history.at(-1).breakBefore, true);
  env.stop();
});

test('USB loss resets both views immediately and recovery requires a new encoder packet', async () => {
  const env = await setup();
  env.emit(); env.advance(100);
  env.store.setReceiver({ ...connected, connected: false, port: null });
  assert.equal(env.store.getSnapshot().state, 'unavailable');
  assert.equal(env.store.getSnapshot().disconnected, true);
  assert.equal(env.store.getSnapshot().packet, null);
  assert.deepEqual(env.store.getSnapshot().history, []);
  env.emit({ encoderSeq: 999 }); env.advance(100);
  assert.equal(env.store.getSnapshot().packet, null, 'Ignore queued events while disconnected');
  env.store.setReceiver(connected);
  assert.equal(env.store.getSnapshot().state, 'no-data');
  env.emit({ encoderSeq: 0 }); env.advance(100);
  assert.equal(env.store.getSnapshot().state, 'receiving');
  assert.equal(env.store.getSnapshot().packet.encoderSeq, 0);
  assert.equal(env.counts().registrations, 1);
  env.stop();
});

test('history and rendering are bounded; invalid and old measurements do not create chart points', async () => {
  const env = await setup();
  let notifications = 0;
  env.store.subscribe(() => notifications++);
  env.emit({ leftRPM: 'bad' });
  env.emit({ ageAtTransmitMs: 5000 });
  env.advance(100);
  assert.equal(env.store.getSnapshot().state, 'stale');
  assert.equal(env.store.getSnapshot().history.length, 0);
  const before = notifications;
  for (let i = 0; i < 1000; i++) env.emit({ encoderSeq: i, leftRPM: i });
  assert.equal(notifications, before, 'Burst events only update in-memory data');
  env.advance(100);
  assert.equal(notifications, before + 1);
  assert.equal(env.store.getSnapshot().packet.encoderSeq, 999);
  assert.equal(env.store.getSnapshot().history.length, ENCODER_HISTORY_LIMIT);
  env.advance(ENCODER_HISTORY_MS + 1);
  assert.deepEqual(env.store.getSnapshot().history, []);
  env.stop();
});

test('connection status failures suppress live RPM consistently without reopening listeners', async () => {
  const env = await setup();
  env.emit(); env.advance(100);
  env.store.setReceiver({ ...connected, connectionError: 'Status unavailable' });
  assert.equal(env.store.getSnapshot().state, 'unavailable');
  assert.equal(env.store.getSnapshot().disconnected, false);
  env.store.setReceiver(connected);
  env.emit({ encoderSeq: 173 }); env.advance(100);
  assert.equal(env.store.getSnapshot().history.at(-1).breakBefore, true, 'Even a short unavailable interval breaks the trace');
  env.store.setReceiver({ ...connected, connectionError: 'Status unavailable' });
  env.emit({ encoderSeq: 900 }); env.advance(4000);
  env.store.setReceiver(connected);
  assert.equal(env.store.getSnapshot().state, 'stale');
  assert.equal(env.store.getSnapshot().packet.encoderSeq, 173);
  assert.equal(env.counts().registrations, 1);
  env.stop();
});

test('late subscriptions and events from a cleaned-up lifecycle are discarded', async () => {
  const finishes = [], oldHandlers = [];
  let stopped = 0;
  const store = createEncoderTelemetryStore({
    listen: (_, handler) => { oldHandlers.push(handler); return new Promise(resolve => { finishes.push(resolve); }); },
    schedule: () => 1, cancel() {}, clock: () => 0, wallClock: () => 10000,
  });
  const stop = store.start(); store.setReceiver(connected);
  await flush(); stop();
  finishes.forEach(finish => finish(() => stopped++));
  oldHandlers.forEach(handler => handler({ payload: packet({ receivedAtMs: 10000 }) }));
  await flush();
  assert.equal(stopped, 2);
  assert.equal(store.getSnapshot().packet, null);
});

test('fresh fusion supplies RPM without fabricating standalone counters or their sequence', async () => {
  const env = await setup();
  env.emitFusion({ leftRPM: 0, rightRPM: 0 }); env.advance(100);
  const snapshot = env.store.getSnapshot();
  assert.equal(snapshot.state, 'receiving');
  assert.equal(snapshot.rpmSource, 'fusion');
  assert.equal(snapshot.rpmPacket.leftRPM, 0);
  assert.equal(snapshot.packet, null);
  assert.equal(snapshot.encoderState, 'no-data');
  assert.equal(snapshot.rpmMinimumAgeMs, 337);
  assert.equal(snapshot.rpmPacket.encoderSeq, undefined);
  env.stop();
});

test('fresh ENC wins, fusion RPM fallback leaves old counters stale, and new ENC restores authority', async () => {
  const env = await setup();
  env.emit(); env.advance(100);
  const authoritative = env.store.getSnapshot().packet;
  env.emitFusion(); env.advance(100);
  assert.equal(env.store.getSnapshot().rpmSource, 'encoder');
  assert.strictEqual(env.store.getSnapshot().packet, authoritative);
  env.advance(2700);
  env.emitFusion({ fusionSeq: 913, leftRPM: 40, rightRPM: 41 }); env.advance(100);
  let snapshot = env.store.getSnapshot();
  assert.equal(snapshot.rpmSource, 'fusion');
  assert.equal(snapshot.state, 'receiving');
  assert.equal(snapshot.encoderState, 'stale');
  assert.strictEqual(snapshot.packet, authoritative);
  assert.equal(snapshot.packet.encoderSeq, 172);
  assert.equal(snapshot.rpmPacket.leftRPM, 40);
  env.emit({ encoderSeq: 173, leftRPM: 50 }); env.advance(100);
  snapshot = env.store.getSnapshot();
  assert.equal(snapshot.rpmSource, 'encoder');
  assert.equal(snapshot.encoderState, 'receiving');
  assert.equal(snapshot.packet.encoderSeq, 173);
  assert.equal(snapshot.history.at(-1).breakBefore, true, 'Changing sources breaks the trace');
  env.stop();
});

test('old or invalid fusion cannot keep RPM fresh, and fusion errors never invalidate fresh ENC', async () => {
  const env = await setup();
  env.emitFusion({ encoderAgeMs: 5000 }); env.advance(100);
  assert.equal(env.store.getSnapshot().state, 'stale');
  env.emitFusion({ fusionSeq: 913 }); env.advance(100);
  assert.equal(env.store.getSnapshot().state, 'receiving');
  env.emitFusion({ fusionSeq: 914, encoderValid: 0 });
  assert.notEqual(env.store.getSnapshot().state, 'receiving');
  env.emit(); env.advance(100);
  env.emitFusion({ fusionSeq: 915, encoderValid: 0 });
  assert.equal(env.store.getSnapshot().state, 'receiving');
  assert.equal(env.store.getSnapshot().rpmSource, 'encoder');
  env.emitFusion({ fusionSeq: 916, encoderValid: 1, leftRPM: 'bad' }); env.advance(100);
  assert.equal(env.store.getSnapshot().rpmSource, 'encoder');
  assert.equal(env.store.getSnapshot().packet.encoderSeq, 172);
  env.stop();
});

test('listener setup failure produces the same unavailable state for all consumers', async () => {
  const store = createEncoderTelemetryStore({
    listen: async () => { throw new Error('Event registration denied'); },
    schedule: () => 1, cancel() {},
  });
  const stop = store.start(); store.setReceiver(connected);
  await flush();
  assert.equal(store.getSnapshot().listenerError, true);
  assert.equal(store.getSnapshot().state, 'unavailable');
  stop();
});

test('a failed fusion listener does not interrupt the authoritative encoder listener', async () => {
  let handler, tick;
  const store = createEncoderTelemetryStore({
    clock: () => 0, wallClock: () => 10000,
    listen: async (name, accept) => {
      if (name === 'fusion-data') throw new Error('Fusion subscription unavailable');
      handler = accept; return () => {};
    }, schedule(fn) { tick = fn; return fn; }, cancel() {},
  });
  const stop = store.start(); store.setReceiver(connected);
  await flush();
  handler({ payload: packet({ receivedAtMs: 10000 }) }); tick();
  assert.equal(store.getSnapshot().state, 'receiving');
  assert.equal(store.getSnapshot().rpmSource, 'encoder');
  assert.equal(store.getSnapshot().packet.encoderSeq, 172);
  assert.equal(store.getSnapshot().listenerError, false);
  stop();
});
