// Run against Vite and a headless Chrome with --remote-debugging-port=9223.
// IPC is replaced in the browser only; no receiver, database or rover is used.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { validateTimedLeg } from '../src/utils/timedMission.js';

const stage = process.argv[2] || 'after';
const capture = process.env.MISSION_BROWSER_CAPTURE !== '0';
const output = new URL(`../docs/validation/a31/${stage}/`, import.meta.url);
if (capture) await mkdir(output, { recursive: true });
const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let serial = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  if (!response.id) return;
  const handler = pending.get(response.id);
  pending.delete(response.id);
  if (response.error) handler.reject(new Error(response.error.message));
  else handler.resolve(response.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  for (let i = 0; i < 300; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
};
const click = async text => {
  const result = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) return false; button.click(); return true; })()`);
  assert.ok(result, `Enabled button: ${text}`);
};
await call('Page.enable');
await call('Page.addScriptToEvaluateOnNewDocument', { source: `
  const callbacks = new Map();
  const listeners = new Map();
  let callbackId = 0;
  window.testCommands = [];
  window.testSamples = [];
  window.testRadio = {connected:false,mode:'RX',revision:1};
  window.testDeploymentId = 100;
  window.testMissions = [{id:1,field_id:1,field_name:'Validation Field',name:'Supervised Mission',mission_date:'2026-11-06',status:'in_progress',pins_geojson:JSON.stringify({type:'MultiPoint',coordinates:[[120.9896,14.6094],[120.9897,14.6095]]})}];
  window.testEmit = (name, payload) => {
    if (name === 'rx-board-connection') window.testRadio = payload;
    (listeners.get(name) || []).forEach(id => callbacks.get(id)?.({event:name,payload}));
  };
  window.testSetDeployment = patch => {
    const deployment = {...window.testRadio.deployment,...patch};
    const mode = ['COMPLETE','CANCELLED','RESTORE'].includes(deployment.phase) ? 'RX' : 'TX';
    window.testEmit('rx-board-connection',{...window.testRadio,connected:true,mode,deployment,revision:window.testRadio.revision+1});
    return deployment;
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
  window.__TAURI_INTERNALS__ = {
    transformCallback(fn) { callbacks.set(++callbackId, fn); return callbackId; },
    convertFileSrc: path => path,
    async invoke(command, args = {}) {
      window.testCommands.push({command,args});
      if (command === 'plugin:event|listen') { listeners.set(args.event, [...(listeners.get(args.event) || []), args.handler]); return args.handler; }
      if (command === 'plugin:event|unlisten') { for (const [name, ids] of listeners) listeners.set(name, ids.filter(id => id !== args.eventId)); return; }
      if (command === 'get_rx_board_connection') return window.testRadio;
      if (command === 'prepare_mission_deployment') {
        const deployment = {id:++window.testDeploymentId,sequence:args.sequence,phase:'READY',attempt:0,acknowledged:false,telemetry_seen:false,rx_restored:false,packet_submitted:false,radio_transmitted:false,evidence:[]};
        window.testRadio = {...window.testRadio,mode:'TX',deployment,revision:window.testRadio.revision+1};
        return deployment;
      }
      if (command === 'confirm_mission_deployment') return window.testSetDeployment({phase:'WAIT_ACK',attempt:1,packet_submitted:true,ground_submitted:true,radio_transmitted:true});
      if (command === 'cancel_mission_deployment') {
        if (window.testRadio.deployment?.phase !== 'COMPLETE') window.testSetDeployment({phase:'CANCELLED',rx_restored:true});
        return;
      }
      if (command === 'get_recent_telemetry') return {records:[],generation:1};
      if (command === 'database_status') return {total:0};
      if (command === 'get_encoder_telemetry') return {connected:false};
      if (command === 'database_select') {
        const sql = args.sql;
        if (/FROM fields f/.test(sql)) return [{id:1,name:'Validation Field',boundary_geojson:JSON.stringify({type:'Polygon',coordinates:[[[120.989,14.609],[120.990,14.609],[120.990,14.610],[120.989,14.610],[120.989,14.609]]]}),mission_count:1}];
        if (/FROM missions m/.test(sql)) return /WHERE m.id/.test(sql) ? window.testMissions.filter(m => m.id === args.values[0]) : [...window.testMissions].sort((a,b) => b.id-a.id);
        return [];
      }
      if (command === 'database_execute') {
        if (/INSERT INTO missions/.test(args.sql)) {
          const id = window.testMissions.length + 1;
          window.testMissions.push({id,field_id:args.values[0],field_name:'Validation Field',name:args.values[1],mission_date:args.values[2],pins_geojson:args.values[3],status:'in_progress'});
          return {rowsAffected:1,lastInsertId:id};
        }
        if (/UPDATE missions/.test(args.sql)) window.testMissions.find(m => m.id === args.values[1]).status = args.values[0];
        if (/INSERT INTO telemetry/.test(args.sql)) {
          if (window.testFailSave) throw new Error('Injected sample save failure');
          await new Promise(resolve => setTimeout(resolve, 30));
          window.testSamples.push(args.values);
        }
        return {rowsAffected:1,lastInsertId:1};
      }
      if (command === 'plugin:path|resolve_directory') return '';
      return null;
    }
  };
` });
try {
  const layouts = [];
  for (const [width, height] of capture ? [[1440, 900], [1024, 768], [800, 900], [800, 600]] : []) {
    const viewport = `${width}${height === 600 ? '-600' : ''}`;
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: process.env.MISSION_BROWSER_URL || 'http://127.0.0.1:1420/' });
    await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Field Map')`);
    await new Promise(resolve => setTimeout(resolve, 600));
    let shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`monitoring-${viewport}.png`, output), Buffer.from(shot.data, 'base64'));
    await click('Field Map');
    await waitFor(`document.body.textContent.includes('Supervised Mission') && !document.body.textContent.includes('Loading fields and missions...')`);
    await new Promise(resolve => setTimeout(resolve, 1200));
    layouts.push({ width, height, boxes: await evaluate(`(() => {
      const box = selector => { const e = document.querySelector(selector); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
      return {sidebar:box('.sidebar'),header:box('.view-header'),directory:box('.field-map-layout > .card:first-child'),map:box('.leaflet-container'),details:box('.field-map-layout__details')};
    })()`) });
    shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`field-map-${viewport}.png`, output), Buffer.from(shot.data, 'base64'));
  }
  if (capture) {
    await writeFile(new URL('layout.json', output), JSON.stringify(layouts, null, 2));
    console.log(`${stage}: screenshots captured at 1440x900, 1024x768, 800x900, 800x600`);
  }
  if (stage !== 'before') {
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: 'http://127.0.0.1:1420/' });
    await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Field Map')`);
    await click('Field Map');
    await waitFor(`document.body.textContent.includes('Operator stage: PLANNING')`);
    await evaluate('document.fonts.ready.then(() => true)');
    await evaluate(`Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => {}))).then(() => true)`);
    // The profile change must not move the surrounding established layout.
    const priorLayout = JSON.parse(await readFile(new URL('../docs/validation/a31/after/layout.json', import.meta.url), 'utf8'))
      .find(viewport => viewport.width === 1440 && viewport.height === 900).boxes;
    const currentLayout = await evaluate(`(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
      return {sidebar:box('.sidebar'),header:box('.view-header'),directory:box('.field-map-layout > .card:first-child'),map:box('.leaflet-container'),details:box('.field-map-layout__details')};
    })()`);
    assert.deepEqual(currentLayout, priorLayout, 'Sidebar, header, directory, map and details-column bounds remain unchanged');
    const check = async text => {
      assert.ok(await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes(${JSON.stringify(text)})); const input = label?.querySelector('input[type=checkbox]'); if (!input || input.disabled) return false; if (!input.checked) input.click(); return true; })()`), text);
    };
    const input = async (label, value) => {
      assert.ok(await evaluate(`(() => { const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`), label);
    };
    const stageIs = async name => waitFor(`document.body.textContent.includes('Operator stage: ${name}')`);
    const assertMovementProfile = async () => {
      assert.ok(await evaluate(`(() => {
        const guide = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send Mission').closest('.card');
        return guide.textContent.includes('Movement profile: Field-tested A3.1') &&
          guide.textContent.includes('Forward: ~0.25 m/s') && guide.textContent.includes('Left/right turn: ~112.5°/s') &&
          !guide.textContent.includes('Movement calibration') && !guide.textContent.includes('I measured these rates') &&
          !guide.querySelector('input[aria-label="Forward speed (m/s)"], input[aria-label="Left turning rate (degrees/s)"], input[aria-label="Right turning rate (degrees/s)"], input[aria-label="Maximum duration per instruction (s)"]');
      })()`));
    };
    const select = async (label, value) => {
      assert.ok(await evaluate(`(() => { const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); if (!select) return false; select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`));
    };
    const newMission = async name => {
      await click('Start New Mission');
      await evaluate(`(() => { const input = document.querySelector('input[placeholder="e.g., UST Field October Scan"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await click('Launch Mission');
      await waitFor(`document.body.textContent.includes(${JSON.stringify('Mission "' + name + '" launched!')})`);
    };
    const reviewReport = async resolution => {
      await select('Report review result', resolution);
      for (const text of ['I physically verified SA is DISARMED', 'I visually verified the rover is stationary.', 'I inspected the reported condition;', 'I verified the probe is fully retracted and clear.']) await check(text);
      await click('Apply local report review — return to planning');
      await stageIs('PLANNING');
    };
    // Receiver discovery/loss during incomplete planning cannot create a safety hold.
    await evaluate(`window.testEmit('rx-board-connection',{connected:true,mode:'RX',port:'TEST',revision:2}); window.testEmit('rx-board-connection',{connected:false,mode:null,revision:3})`);
    await stageIs('PLANNING');
    assert.equal(await evaluate(`document.body.textContent.includes('Hold source:')`), false);
    await evaluate(`window.testEmit('rx-board-connection',{connected:true,mode:'RX',port:'TEST',revision:4})`);
    const estimatePosition = async () => {
      await click('Select position on map');
      const rect = await evaluate(`(() => { const map = document.querySelector('.leaflet-container'); map.scrollIntoView({block:'center'}); const r = map.getBoundingClientRect(); return {x:r.x+r.width*0.25,y:r.y+r.height*0.35}; })()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
      await waitFor(`document.body.textContent.includes('OPERATOR_ESTIMATED:')`);
    };
    const confirmStart = async () => {
      await estimatePosition();
      await input('Actual rover heading', 0);
      await check('I verified the actual rover heading.');
      await check('I verified the probe is fully retracted and clear, and the path is safe.');
      await click('Confirm start and heading');
      await stageIs('READY');
    };
    const inspectWithoutMoving = async () => {
      await check('I visually verified that the rover is stopped');
      await click('Inspect arrival without movement');
      await stageIs('INSPECTION');
    };
    const acceptEstimate = async () => {
      await estimatePosition();
      await check('I visually accept this sampling location');
      await click('Accept arrival and sample');
      await stageIs('SAMPLING');
    };
    const finishSampling = async () => {
      assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Confirm sampling finished and probe retracted' && b.disabled)`));
      await check('Sampling is finished at this location.');
      await check('I visually verified the probe is fully retracted and clear.');
      await click('Confirm sampling finished and probe retracted');
    };
    assert.equal(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send Mission' && b.disabled)`), true);
    assert.equal(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Use fresh GPS' && b.disabled)`), true);
    // No GPS: real map selection, actual heading confirmation and bounded preview.
    await assertMovementProfile();
    await confirmStart();
    await assertMovementProfile();
    await waitFor(`document.body.textContent.includes('Partial leg only')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send Mission').closest('.card').scrollIntoView({block:'start'})`);
    assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send Mission' && !b.disabled)`));
    if (capture) {
      const previewShot = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(new URL('leg-preview-1440.png', output), Buffer.from(previewShot.data, 'base64'));
    }
    // Manual takeover invalidates start, followed by explicit stopped inspection.
    await check('I verified the probe is fully retracted and the path is safe before manual RC driving.');
    await click('Use manual RC repositioning');
    await stageIs('MANUAL');
    await check('I used physical RC HOLD/DISARM');
    await click('Rover stopped — inspect arrival');
    await stageIs('INSPECTION');
    assert.ok(await evaluate(`document.body.textContent.includes('Execution unverified — operator inspection required')`));
    await click('Reject arrival — prepare corrected leg');
    await stageIs('PLANNING');
    assert.equal(await evaluate(`document.querySelector('input[aria-label="Actual rover heading"]').value`), '');
    await confirmStart();
    await inspectWithoutMoving();
    await acceptEstimate();
    await click('Start Logging');
    await click('Pause Logging');
    await evaluate(`window.testEmit('sensor-data',{soilValid:1,lat:0,lng:0,satsLocked:0,moisture:40,ph:6.5})`);
    assert.equal(await evaluate('window.testSamples.length'), 0);
    await click('Resume');
    // A failed save remains retryable, then a burst saves exactly once.
    await evaluate(`window.testFailSave=true; window.testEmit('sensor-data',{soilValid:1,lat:0,lng:0,satsLocked:0,moisture:40,ph:6.5,ec:0.3,nitrogen:20,phosphorus:15,potassium:30})`);
    await waitFor(`document.body.textContent.includes('A sample could not be saved')`);
    assert.equal(await evaluate('window.testSamples.length'), 0);
    await evaluate(`window.testFailSave=false; for(let i=0;i<10;i++) window.testEmit('sensor-data',{soilValid:1,lat:0,lng:0,satsLocked:0,moisture:40,ph:6.5,ec:0.3,nitrogen:20,phosphorus:15,potassium:30})`);
    await stageIs('RETRACT');
    assert.equal(await evaluate('window.testSamples.length'), 1);
    assert.deepEqual(await evaluate('window.testSamples[0].slice(3,5)'), [null, null]);
    await finishSampling();
    await stageIs('NEXT LEG');
    await click('Authorize preparation of next leg');
    await stageIs('PLANNING');
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Next sampling pin"]').value`), '1');
    // GPS sample at a different physical location is retained; no 5 m gate.
    await confirmStart();
    await inspectWithoutMoving();
    await evaluate(`window.testEmit('sensor-data',{soilValid:0,lat:14.6099,lng:120.9899,satsLocked:8,heading:90,course:270})`);
    await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Use fresh GPS' && !b.disabled)`);
    await click('Use fresh GPS');
    await check('I visually accept this sampling location');
    await click('Accept arrival and sample');
    await stageIs('SAMPLING');
    await evaluate(`window.testEmit('sensor-data',{soilValid:1,lat:14.6099,lng:120.9899,satsLocked:8,moisture:45,ph:6.7,ec:0.4,nitrogen:21,phosphorus:16,potassium:31})`);
    await stageIs('RETRACT');
    assert.equal(await evaluate('window.testSamples.length'), 2);
    assert.deepEqual(await evaluate('window.testSamples[1].slice(3,5)'), [14.6099, 120.9899]);
    await finishSampling();
    await stageIs('COMPLETE');
    await click('Mark Finished');
    await waitFor(`document.body.textContent.includes('Mission completed and findings logged.')`);
    assert.equal(await evaluate(`window.testCommands.filter(c => /prepare_mission_deployment|confirm_mission_deployment|send_mission|serial_write/.test(c.command)).length`), 0);
    console.log('Browser integration passed: fixed field-tested profile without calibration inputs, map fallback, manual takeover, rejection, retry/deduplication, no-GPS and off-pin GPS saving, retraction, next-leg authorization, completion, no powered upload.');
    if (capture) {
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(new URL('mission-completed-1440.png', output), Buffer.from(shot.data, 'base64'));
    }
    // Resume preserves the saved record while requiring new confirmations.
    await click('Resume Mission');
    await stageIs('PLANNING');
    await confirmStart();
    // Receiver loss during a preview is ordinary planning; only an active
    // operation needs an explicit workflow hold and inspection after reconnect.
    await evaluate(`window.testEmit('rx-board-connection',{connected:false,mode:null,revision:5})`);
    await stageIs('READY');
    await evaluate(`window.testEmit('rx-board-connection',{connected:true,mode:'RX',port:'TEST',revision:6})`);
    await check('I verified the probe is fully retracted and the path is safe before manual RC driving.');
    await click('Use manual RC repositioning');
    await stageIs('MANUAL');
    await evaluate(`window.testEmit('rx-board-connection',{connected:false,mode:null,revision:7})`);
    await stageIs('HELD');
    assert.ok(await evaluate(`document.body.textContent.includes('Hold source: Workflow interruption') && document.body.textContent.includes('Desktop receiver disconnected')`));
    await evaluate(`window.testEmit('rx-board-connection',{connected:true,mode:'RX',port:'TEST',revision:8})`);
    await stageIs('HELD');
    await click('Prepare again after inspection');
    await stageIs('PLANNING');
    await click('Report obstacle / RC loss / safety hold');
    await stageIs('HELD');
    assert.ok(await evaluate(`document.body.textContent.includes('Hold source: Operator report (local)') && document.body.textContent.includes('REPORT_OPERATOR_FAULT button')`));
    assert.ok(await evaluate(`![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Prepare again after inspection')`));
    assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Apply local report review — return to planning' && b.disabled)`));
    await click('Live Monitoring');
    await click('Field Map');
    await stageIs('HELD');
    // Returning to the mission retains its report; all physical checks are required.
    await reviewReport('ENTERED_IN_ERROR');
    assert.equal(await evaluate(`document.querySelector('input[aria-label="Actual rover heading"]').value`), '');
    await click('Report obstacle / RC loss / safety hold');
    await click('Cancel mission — use RC HOLD/DISARM');
    await stageIs('CANCELLED');
    assert.ok(await evaluate(`window.testCommands.some(c => c.command === 'database_execute' && /UPDATE missions/.test(c.args.sql) && c.args.values.includes('cancelled'))`));
    assert.equal(await evaluate(`window.testCommands.filter(c => /prepare_mission_deployment|confirm_mission_deployment|send_mission|serial_write/.test(c.command)).length`), 0);
    await newMission('Fresh after cancelled local report');
    await stageIs('PLANNING');
    assert.equal(await evaluate(`document.body.textContent.includes('Hold source:')`), false);
    // A physically confirmed condition follows a new mission, until resolved.
    await click('Report obstacle / RC loss / safety hold');
    await click('Confirm reported physical condition is present');
    await stageIs('HELD');
    assert.equal(await evaluate(`!!document.querySelector('option[value="ENTERED_IN_ERROR"]')`), false);
    await click('Cancel mission — use RC HOLD/DISARM');
    await newMission('Fresh with active physical condition');
    await stageIs('HELD');
    await reviewReport('PHYSICALLY_RESOLVED');
    console.log('Hold regression passed: disconnected planning/preview, workflow loss/reconnect, exact hold sources, guarded false-report correction, scoped cancellation/new missions, and genuine physical-condition resolution.');
    for (const [tab, expected] of [['Live Monitoring', 'Live Monitoring Board'], ['Reports', 'Reports'], ['User Manual', 'Rover Operation Guide']]) {
      await click(tab);
      await waitFor(`document.body.textContent.includes(${JSON.stringify(expected)})`);
    }
    console.log('Browser navigation smoke passed: Live Monitoring, Reports and User Manual.');
    await click('Field Map');
    await stageIs('PLANNING');
    assert.equal(await evaluate(`document.body.textContent.includes('Hold source:')`), false);
    console.log('Corrected physical reports do not reappear after page navigation.');
    // Timed pathway: all IPC and radio evidence below remain isolated fixtures.
    await confirmStart();
    await assertMovementProfile();
    await click('Send Mission');
    await waitFor(`!!document.querySelector('[role="dialog"][aria-labelledby="deployment-title"]')`);
    await stageIs('UPLOADING');
    const uploaded = await evaluate(`window.testCommands.filter(c => c.command === 'prepare_mission_deployment').at(-1).args`);
    assert.equal(uploaded.timed, true);
    assert.equal(validateTimedLeg(uploaded.sequence).error, undefined);
    assert.ok(validateTimedLeg(uploaded.sequence).totalS <= 4);
    assert.equal(await evaluate(`window.testCommands.filter(c => c.command === 'confirm_mission_deployment').length`), 0);
    const confirmUpload = async () => {
      await check('Set SB (CH6) to HOLD.');
      await check('Set SA (CH5) to DISARM.');
      await check('Set SD (CH8) to RX.');
      await click('Confirm rover ready · Send mission');
    };
    await confirmUpload();
    await evaluate(`window.testSetDeployment({phase:'ACKNOWLEDGED',acknowledged:true})`);
    await stageIs('UPLOADING');
    assert.equal(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Record HOLD → SEMI_AUTO authorization')`), false);
    await evaluate(`window.testSetDeployment({phase:'COMPLETE',acknowledged:true,rx_restored:true,telemetry_seen:true})`);
    await stageIs('AWAITING START');
    assert.ok(await evaluate(`document.body.textContent.includes('Mission execution: Operator unverified') && document.body.textContent.includes('does not forward Mega MISSION_STATUS')`));
    assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Record HOLD → SEMI_AUTO authorization' && b.disabled)`));
    await check('I verified fresh neutral RC sticks');
    await check('With rover LoRa back in TX, I safely armed');
    assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Record HOLD → SEMI_AUTO authorization' && b.disabled)`));
    await check('After armed HOLD, I deliberately selected HOLD');
    await click('Record HOLD → SEMI_AUTO authorization');
    await stageIs('EXECUTION UNVERIFIED');
    assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="deployment-title"]')`), false);
    assert.equal(await evaluate(`window.testCommands.filter(c => c.command === 'prepare_mission_deployment').length`), 1);
    assert.equal(await evaluate(`window.testCommands.filter(c => /send_movement_sequence|serial_write|start_mission/.test(c.command)).length`), 0);
    await check('I used physical RC HOLD/DISARM and visually verified the rover has stopped.');
    await click('Rover stopped — inspect arrival');
    await stageIs('INSPECTION');
    await click('Reject arrival — prepare corrected leg');
    await stageIs('PLANNING');
    assert.equal(await evaluate(`window.testCommands.filter(c => c.command === 'prepare_mission_deployment').length`), 1);
    assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send Mission' && b.disabled)`));
    // Closing before submission discards the plan; after possible delivery it
    // leaves an explicit inspection hold instead of enabling another upload.
    await confirmStart();
    await click('Send Mission');
    await waitFor(`!!document.querySelector('[aria-label="Close deployment guide"]')`);
    await evaluate(`document.querySelector('[aria-label="Close deployment guide"]').click()`);
    await stageIs('PLANNING');
    await confirmStart();
    await click('Send Mission');
    await confirmUpload();
    await evaluate(`window.testSetDeployment({phase:'COMPLETE',acknowledged:true,rx_restored:true,telemetry_seen:true})`);
    await stageIs('AWAITING START');
    await evaluate(`document.querySelector('[aria-label="Close deployment guide"]').click()`);
    await stageIs('HELD');
    assert.ok(await evaluate(`document.body.textContent.includes('UPLOAD_CLOSED')`));
    await click('Prepare again after inspection');
    await confirmStart();
    await click('Send Mission');
    await evaluate(`window.testSetDeployment({phase:'FAILED',failure_code:'SERIAL_WRITE_FAILED',error:'Partial serial write; delivery unverified.',packet_submitted:false,ground_submitted:false,radio_transmitted:false,acknowledged:false})`);
    await evaluate(`document.querySelector('[aria-label="Close deployment guide"]').click()`);
    await stageIs('HELD');
    assert.ok(await evaluate(`document.body.textContent.includes('UPLOAD_CLOSED')`));
    console.log('Timed upload integration passed: valid bounded sequence through the existing wizard, ACK2 cannot start, physical neutral/armed-HOLD/HOLD-to-SEMI confirmations, operator-unverified execution, no start command, no automatic next leg, and safe upload closure.');
  }
} finally {
  socket.close();
}
