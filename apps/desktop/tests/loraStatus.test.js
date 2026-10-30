import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createLoRaConnectionStore } from '../src/services/loraConnectionStore.js';
import { getConnectionStatus, getDeploymentFailure, getDeploymentProgress } from '../src/utils/loraStatus.js';

const missing = { connected:false, port:null, mode:null, revision:0 };
const discovered = { connected:true, port:'detected-usb-port', mode:'RX', revision:2 };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};

let server, ConnectionStatus;
before(async () => {
  // Vite transforms the real JSX/CSS without a browser or a hardware connection.
  server = await createServer({
    configFile:false, root:fileURLToPath(new URL('../', import.meta.url)),
    optimizeDeps:{noDiscovery:true, include:[]},
    server:{middlewareMode:true, hmr:false, watch:null},
  });
  ConnectionStatus = (await server.ssrLoadModule('/src/components/LoRaConnectionStatus.jsx')).default;
});
after(async () => { await server?.close(); });

const render = (connection, failure) => renderToStaticMarkup(React.createElement(ConnectionStatus, {connection, failure}));

test('missing receiver renders a searching status without a failure heading', () => {
  const failure = getDeploymentFailure(null, {stage:'prepare', message:'Waiting for rover — Check USB/COM port'});
  assert.equal(failure, null);
  const html = render(missing, failure);
  assert.match(html, /Searching for desktop LoRa…/);
  assert.match(html, /Waiting for receiver — Check USB\/COM port/);
  assert.match(html, /lora-connection-status__ring/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /Failed|role="alert"|detected-usb-port/);
});

test('discovery shows the backend port and mode without claiming rover reachability', () => {
  const html = render(discovered);
  assert.match(html, /Desktop LoRa connected/);
  assert.match(html, /detected-usb-port · Mode: RX/);
  assert.match(html, /Rover reception is verified separately/);
  assert.doesNotMatch(html, /lora-connection-status__ring|Rover Connected/);
  assert.equal(getConnectionStatus({...discovered, port:null, mode:null}).detail, 'Mode: Unknown');
});

test('receiver removal outside a deployment is amber rather than a transmission error', () => {
  const html = render({...missing, hadConnection:true});
  assert.match(html, /Desktop LoRa disconnected/);
  assert.match(html, /lora-connection-status--disconnected/);
  assert.doesNotMatch(html, /role="alert"|Mission transmission failed/);
});

test('USB removal during deployment retains the real backend diagnostic', () => {
  const detail = 'USB connection lost. RX restoration could not be verified. Check USB/COM port.';
  const failure = getDeploymentFailure({phase:'FAILED', error:detail});
  assert.equal(failure.state, 'connection-failed');
  const html = render({...missing, hadConnection:true}, failure);
  assert.match(html, /Deployment interrupted — desktop LoRa disconnected/);
  assert.match(html, /USB connection lost/);
  assert.match(html, /role="alert"/);
});

test('a real status API failure shows its diagnostic without inventing a hardware cause', () => {
  const html = render({...missing, connectionError:'Receiver status command denied by Tauri'});
  assert.match(html, /Unable to read desktop LoRa connection status/);
  assert.match(html, /Receiver status command denied by Tauri/);
  assert.doesNotMatch(html, /Searching for desktop LoRa|Desktop LoRa connected/);
});

for (const [detail, title, state] of [
  ['Desktop LoRa did not confirm TX mode.', 'Failed to switch desktop LoRa to TX', 'operation-failed'],
  ['[LoRa TX] Mission transmission failed.', 'Mission transmission failed', 'transmission-failed'],
  ['Desktop firmware did not confirm mission transmission.', 'Mission transmission failed', 'transmission-failed'],
  ['Missing or mismatched mission ACK. Mission delivery is not confirmed.', 'No matching acknowledgment received from rover', 'transmission-failed'],
  ['Failed to restore desktop RX. Check USB/COM port before continuing.', 'Unable to restore desktop LoRa RX', 'operation-failed'],
  ['No fresh rover telemetry received. Check rover CH8 = TX. Do not arm.', 'Rover telemetry has not resumed', 'operation-failed'],
]) {
  test(`${title} keeps physical USB connectivity separate`, () => {
    const failure = getDeploymentFailure({phase:'FAILED', error:detail});
    assert.equal(failure.title, title);
    assert.equal(failure.state, state);
    const html = render(discovered, failure);
    assert.match(html, /Desktop LoRa connected/);
    assert.ok(html.includes(title));
    assert.doesNotMatch(html, /Unable to read desktop LoRa connection|Desktop LoRa disconnected/);
  });
}

test('RX recovery failure retains the preceding mission error', () => {
  const detail = 'Missing or mismatched mission ACK. Failed to restore desktop RX.';
  const failure = getDeploymentFailure({phase:'FAILED', error:detail});
  assert.equal(failure.title, 'Unable to restore desktop LoRa RX');
  assert.equal(failure.detail, detail);
});

test('backend disconnect evidence takes priority over an earlier button error', () => {
  const failure = getDeploymentFailure({phase:'FAILED', error:'USB connection lost.'}, {stage:'confirm', message:'Wait for TX'});
  assert.equal(failure.state, 'connection-failed');
});

test('successful ACK and telemetry restoration do not produce a failure', () => {
  const deployment = {phase:'COMPLETE', error:null, acknowledged:true, telemetry_seen:true};
  assert.equal(getDeploymentFailure(deployment), null);
  const html = render({...discovered, deployment});
  assert.doesNotMatch(html, /role="alert"|Mission transmission failed/);
});

test('retry exhaustion explains rover communication failure while USB remains connected', () => {
  const deployment = {phase:'FAILED', failure_code:'ACK_EXHAUSTED', retry_exhausted:true,
    attempt:8, max_attempts:8, error:'No valid matching rover ACK after 8 attempts.'};
  const failure = getDeploymentFailure(deployment);
  assert.equal(failure.title, 'Unable to establish communication with the rover');
  assert.equal(failure.state, 'transmission-failed');
  const html = render(discovered, failure);
  assert.match(html, /Desktop LoRa connected/);
  assert.match(html, /No valid matching rover ACK after 8 attempts/);
  assert.doesNotMatch(html, /USB connection lost/);
});

test('attempt notifications come from backend counters and preserve distinct milestones', () => {
  assert.equal(getDeploymentProgress({phase:'TRANSMITTING', attempt:1, max_attempts:8}), 'Transmitting mission — Attempt 1 of 8');
  assert.equal(getDeploymentProgress({phase:'WAIT_ACK', attempt:4, max_attempts:8}), 'Waiting for rover acknowledgment — Attempt 4 of 8');
  assert.equal(getDeploymentProgress({phase:'RETRYING', attempt:3, max_attempts:8}), 'No ACK received — Retrying (Attempt 4 of 8)');
  assert.match(getDeploymentProgress({phase:'TRANSMITTING', attempt:2, max_attempts:4}), /Attempt 2 of 4/);
  assert.equal(getDeploymentProgress({phase:'ACKNOWLEDGED'}), 'Rover acknowledged mission');
  assert.equal(getDeploymentProgress({phase:'SWITCH_RX'}), 'Restoring desktop RX');
  assert.equal(getDeploymentProgress({phase:'RESTORE'}), 'Waiting for fresh rover telemetry');
  assert.equal(getDeploymentProgress({phase:'WAIT_ACK'}, true), 'Cancelling — restoring desktop RX…');
  assert.equal(getDeploymentProgress(null), null);
});

test('protocol and unresolved handoff failures show the actual diagnostic', () => {
  const missingFirmware = getDeploymentFailure({failure_code:'PROTOCOL_REQUIRED', error:'Desktop ESP32 requires coordinated MISSION_V2 firmware.'});
  assert.equal(missingFirmware.title, 'ESP32 mission protocol update required');
  const unresolved = getDeploymentFailure({failure_code:'ROVER_REJECTED', error:'NACK2:mission-key:HANDOFF_OUTCOME_UNKNOWN'});
  assert.match(unresolved.title, /operator recovery required/);
  assert.match(unresolved.detail, /HANDOFF_OUTCOME_UNKNOWN/);
});

test('manual recovery action errors are visible alongside the original failure', () => {
  const failure = getDeploymentFailure({failure_code:'ACK_EXHAUSTED', error:'No ACK after 8 attempts'}, {stage:'retry', message:'Status command unavailable'});
  assert.match(failure.detail, /No ACK after 8 attempts/);
  assert.match(failure.detail, /Status command unavailable/);
});

test('views share one listener and an old snapshot cannot overwrite a discovery', async () => {
  const pendingSnapshot = deferred();
  let onEvent, listenCount = 0, stopCount = 0;
  const store = createLoRaConnectionStore({
    listen:async (name, callback) => {
      assert.equal(name, 'rx-board-connection');
      listenCount++;
      onEvent = callback;
      return () => { stopCount++; };
    },
    invoke:async command => {
      assert.equal(command, 'get_rx_board_connection');
      return pendingSnapshot.promise;
    },
  });
  const stopMap = store.subscribe(() => {});
  const stopWizard = store.subscribe(() => {});
  await flush();
  onEvent({payload:discovered});
  pendingSnapshot.resolve(missing);
  await flush();
  assert.equal(listenCount, 1);
  assert.equal(store.getSnapshot().port, discovered.port);
  stopMap();
  assert.equal(stopCount, 0);
  stopWizard();
  assert.equal(stopCount, 1);
});

test('stale events and pending subscriptions are discarded after StrictMode cleanup', async () => {
  const pendingListener = deferred();
  let firstEvent, currentEvent, listenCount = 0, staleStops = 0;
  const store = createLoRaConnectionStore({
    listen:async (name, callback) => {
      if (++listenCount === 1) { firstEvent = callback; return pendingListener.promise; }
      currentEvent = callback;
      return () => {};
    },
    invoke:async () => missing,
  });
  const stopFirst = store.subscribe(() => {});
  stopFirst();
  const stopCurrent = store.subscribe(() => {});
  pendingListener.resolve(() => { staleStops++; });
  await flush();
  firstEvent({payload:{...discovered, revision:100}});
  assert.equal(store.getSnapshot().connected, false);
  currentEvent({payload:discovered});
  assert.equal(store.getSnapshot().connected, true);
  assert.equal(staleStops, 1);
  stopCurrent();
});

test('status-read errors clear only on real backend state and removal preserves connection history', async () => {
  let onEvent;
  const store = createLoRaConnectionStore({
    listen:async (name, callback) => { onEvent = callback; return () => {}; },
    invoke:async () => { throw new Error('Status read failed'); },
  });
  const stop = store.subscribe(() => {});
  await flush();
  assert.equal(getConnectionStatus(store.getSnapshot()).state, 'connection-failed');
  onEvent({payload:discovered});
  assert.equal(getConnectionStatus(store.getSnapshot()).state, 'connected');
  assert.equal(store.getSnapshot().connectionError, null);
  onEvent({payload:{...missing, revision:3}});
  assert.equal(getConnectionStatus(store.getSnapshot()).state, 'disconnected');
  stop();
});
