import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createEncoderMonitor, isEncoderEvent, rotationDirection, rpmDifferencePercent } from '../src/utils/encoderTelemetry.js';

const mocks = readFileSync(new URL('./fixtures/encoder-stream.jsonl', import.meta.url), 'utf8')
  .split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
  .filter(data => data.type === 'encoder' && typeof data.leftRPM === 'number');
const received = (index = 0, overrides = {}) => ({ ...mocks[index], receivedAtMs: 10000, ...overrides });
const setup = () => {
  let now = 0, wall = 10000;
  return { monitor: createEncoderMonitor({ clock: () => now, wallClock: () => wall }),
    advance(ms) { now += ms; wall += ms; }, changeWall(ms) { wall += ms; } };
};

let server, Card, HistoryChart;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false, hmr: false, watch: null } });
  Card = (await server.ssrLoadModule('/src/components/DrivetrainTelemetry.jsx')).DrivetrainTelemetryCard;
  HistoryChart = (await server.ssrLoadModule('/src/components/RpmHistoryChart.jsx')).default;
});
after(async () => { await server?.close(); });
const render = snapshot => renderToStaticMarkup(React.createElement(Card, { snapshot, staleAfterMs: 3000, onTimeoutChange() {} }));

test('stationary, rotating, negative and unequal RPM use the specified synchronization metric', () => {
  assert.equal(rpmDifferencePercent(0, 0), 0);
  assert.equal(rpmDifferencePercent(0.1, -0.1), 0);
  assert.equal(rpmDifferencePercent(45, 45), 0);
  assert.ok(Math.abs(rpmDifferencePercent(-44.97, -44.65) - 0.7141263) < 0.00001);
  assert.ok(Math.abs(rpmDifferencePercent(-30, 60) - 66.6666667) < 0.00001);
  assert.equal(rpmDifferencePercent(0, 60), 200);
  assert.equal(rpmDifferencePercent(1e308, -1e308), 0);
  assert.equal(rotationDirection(0), 'Stopped');
  assert.equal(rotationDirection(-44), 'Negative rotation (−)');
  assert.equal(rotationDirection(44), 'Positive rotation (+)');
});

test('missing, malformed, non-finite and unsafe event values cannot replace valid readings', () => {
  const { monitor } = setup();
  assert.equal(monitor.accept(received()), true);
  for (const key of Object.keys(received())) {
    const invalid = received(); delete invalid[key];
    assert.equal(monitor.accept(invalid), false, key);
  }
  for (const bad of [null, [], { ...received(), leftRPM: NaN }, { ...received(), rightRPM: Infinity },
    { ...received(), leftRPM: '45' }, { ...received(), leftTicks: 1.5 },
    { ...received(), rightTicks: Number.MAX_SAFE_INTEGER + 1 }, { ...received(), invalidL: -1 },
    { ...received(), invalidR: 2 ** 32 }, { ...received(), encoderSeq: 0.1 },
    { ...received(), ageAtTransmitMs: -1 }, { ...received(), receivedAtMs: null }]) {
    assert.equal(isEncoderEvent(bad), false);
    assert.equal(monitor.accept(bad), false);
  }
  assert.equal(monitor.snapshot(true).packet.encoderSeq, 170);
});

test('freshness includes rover age, native-to-UI delivery and monotonic desktop elapsed time', () => {
  const env = setup();
  env.advance(100);
  env.monitor.accept(received(2));
  let snapshot = env.monitor.snapshot(true);
  assert.equal(snapshot.minimumAgeMs, 1009);
  assert.equal(snapshot.sincePacketMs, 100);
  env.advance(1991);
  snapshot = env.monitor.snapshot(true);
  assert.equal(snapshot.minimumAgeMs, 3000);
  assert.equal(snapshot.state, 'stale');
  env.changeWall(-100000);
  assert.equal(env.monitor.snapshot(true).state, 'stale');
  assert.equal(env.monitor.snapshot(true, 5000).state, 'receiving');
});

test('old-at-transmit packets are stale immediately, and new packets restore reception', () => {
  const { monitor } = setup();
  monitor.accept(received(4));
  assert.equal(monitor.snapshot(true).state, 'stale');
  monitor.accept(received(1));
  assert.equal(monitor.snapshot(true).state, 'receiving');
  assert.equal(monitor.snapshot(true).packet.leftRPM, 45);
});

test('disconnect hides RPM immediately and reset requires a new packet after reconnect', () => {
  const { monitor } = setup();
  assert.equal(monitor.snapshot(true).state, 'no-data');
  monitor.accept(received(1));
  assert.equal(monitor.snapshot(false).state, 'unavailable');
  assert.doesNotMatch(render(monitor.snapshot(false)), /\+45\.00/);
  monitor.reset();
  assert.equal(monitor.snapshot(true).packet, null);
  assert.equal(monitor.snapshot(true).state, 'no-data');
  monitor.accept(received(0, { encoderSeq: 0 }));
  assert.equal(monitor.snapshot(true).state, 'receiving');
});

test('real card displays No Data, signed rotation, counts, errors and freshness without performance labels', () => {
  const { monitor } = setup();
  assert.match(render(monitor.snapshot(true)), /No Data/);
  monitor.accept(received(2));
  let html = render(monitor.snapshot(true));
  assert.match(html, /Receiving/);
  assert.match(html, /-44\.97/);
  assert.match(html, /Negative rotation/);
  assert.match(html, /0\.71%/);
  assert.match(html, /13,501/);
  assert.match(html, /Encoder errors/);
  assert.match(html, /Age at transmit/);
  assert.match(html, /end-to-end latency/);
  assert.doesNotMatch(html, /Excellent|Poor|Synchronized|Reverse rotation/);
  monitor.accept(received(0));
  html = render(monitor.snapshot(true));
  assert.match(html, /Stopped/);
  assert.match(html, /0\.00%/);
});

test('stale UI suppresses RPM, direction and RPM difference while identifying historical counts', () => {
  const env = setup();
  env.monitor.accept(received(2));
  env.advance(3000);
  const html = render(env.monitor.snapshot(true));
  assert.match(html, /Stale/);
  assert.match(html, /last accepted packet/);
  assert.doesNotMatch(html, /-44\.97|-44\.65|0\.71%|Negative rotation/);
});

test('dashboard reuses the real card and chart shows signed history with gaps and stale labeling', () => {
  const { monitor } = setup();
  monitor.accept(received(2));
  const history = [{ at: 0, leftRPM: -30, rightRPM: 60, breakBefore: true },
    { at: 1000, leftRPM: -40, rightRPM: 50, breakBefore: false },
    { at: 5000, leftRPM: -20, rightRPM: 40, breakBefore: true }];
  const chart = React.createElement(HistoryChart, { history, nowMs: 5000, state: 'stale' });
  const html = renderToStaticMarkup(React.createElement(Card, {
    snapshot: monitor.snapshot(true), staleAfterMs: 3000, onTimeoutChange() {}, title: 'Drivetrain Monitoring',
  }, chart));
  assert.match(html, /Drivetrain Monitoring/);
  assert.match(html, /-44\.97/);
  assert.match(html, /History only/);
  assert.match(html, /Left motor/);
  assert.match(html, /Right motor/);
  assert.match(html, /Gaps are not interpolated/);
  const paths = [...html.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  for (const path of paths) {
    assert.equal((path.match(/M/g) || []).length, 2, 'Each series must break at the stale gap');
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
});

test('fusion RPM is visibly separate from stale or absent authoritative ENC counters', () => {
  const rpmPacket = { type: 'fusion', fusionSeq: 912, encoderValid: 1, leftRPM: 12, rightRPM: 13,
    encoderAgeMs: 237, receivedAtMs: 10000 };
  const snapshot = { packet: received(2), state: 'receiving', encoderState: 'stale', rpmSource: 'fusion',
    rpmPacket, rpmMinimumAgeMs: 337, minimumAgeMs: 5000, sincePacketMs: 4091 };
  let html = render(snapshot);
  assert.match(html, /Fusion fallback/);
  assert.match(html, /\+12\.00/);
  assert.doesNotMatch(html, /-44\.97/);
  assert.match(html, /13,501/);
  assert.match(html, /ENC counters/);
  assert.match(html, /Stale/);
  assert.match(html, /last accepted ENC packet/);
  assert.match(html, /Encoder sequence<\/dt><dd>172/);
  assert.match(html, /RPM fusion sequence<\/dt><dd>912/);
  html = render({ ...snapshot, packet: null, encoderState: 'no-data', minimumAgeMs: null, sincePacketMs: null });
  assert.match(html, /No ENC counter data/);
  assert.match(html, /Encoder ticks<\/dt><dd>—/);
  assert.match(html, /Encoder sequence<\/dt><dd>—/);
});
