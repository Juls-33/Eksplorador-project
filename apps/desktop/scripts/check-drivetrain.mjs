// Real Chromium, isolated Tauri event mocks, no hardware/database/network writes.
// Usage: node scripts/check-drivetrain.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'eksplorador-drivetrain-'));
const fixture = (await readFile(join(root, 'tests/fixtures/encoder-stream.jsonl'), 'utf8')).split('\n')
  .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const packets = fixture.filter(data => data.type === 'encoder' && typeof data.leftRPM === 'number');
const sensor = fixture.find(data => data.seq === 90);
const actualFusion = (await readFile(join(root, 'tests/fixtures/actual-a27-receiver.log'), 'utf8')).split('\n')
  .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(data => data.type === 'fusion');
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
assert.ok(browserPath, 'Set CHROME_PATH to an installed Chromium executable');
const server = await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } });
await server.listen();
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${join(output, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket, closeBrowser;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not start within 20 seconds')), 20000);
    browser.stderr.on('data', data => { text += data; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    browser.on('error', error => { clearTimeout(timer); reject(error); });
    browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited: ${code}`)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0, session;
  const pending = new Map(), errors = [];
  const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) { const item = pending.get(msg.id); pending.delete(msg.id); msg.error ? item?.reject(new Error(JSON.stringify(msg.error))) : item?.resolve(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description);
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(arg => arg.value ?? arg.description).join(' '));
    else if (msg.method === 'Fetch.requestPaused') void send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'BlockedByClient' });
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  closeBrowser = () => send('Browser.close', {}, null);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 240; i++) {
      if (await evaluate(expression)) return;
      await evaluate('new Promise(resolve => setTimeout(resolve, 25))');
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const emit = (name, payload) => evaluate(`window.__emit(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
  const emitEncoder = (index, overrides = {}) => evaluate(`window.__emit('encoder-data', {...${JSON.stringify(packets[index])}, receivedAtMs:Date.now(), ...${JSON.stringify(overrides)}})`);
  const card = 'document.querySelector(".drivetrain-telemetry")';
  const state = name => `${card}?.querySelector('[role=status]').textContent === '${name}'`;
  const navigate = label => evaluate(`document.querySelector('.nav-list [aria-label="${label}"]').click()`);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*openstreetmap.org*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    let next=1; const callbacks=new Map(), events=new Map(); window.__calls=[];
    window.__emit=(event,payload)=>{for(const value of events.values()) if(value.event===event) callbacks.get(value.handler)?.({payload});};
    window.__listenerCount=event=>[...events.values()].filter(value=>value.event===event).length;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(event,id){events.delete(id);}};
    window.__TAURI_INTERNALS__={transformCallback(fn){const id=next++;callbacks.set(id,fn);return id;},unregisterCallback(id){callbacks.delete(id);},convertFileSrc(){return '/mock-tile';},async invoke(command,args={}){
      window.__calls.push({command,args});
      if(command==='database_select')return args.sql.includes('_app_meta')?[{value:'1'}]:[];
      if(command==='get_recent_telemetry')return {records:[],generation:0};
      if(command==='database_status')return {total:0};
      if(command==='get_rx_board_connection')return {connected:false,port:null,mode:null,revision:0};
      if(command==='plugin:event|listen'){const id=next++;events.set(id,args);return id;}
      if(command==='plugin:event|unlisten'){events.delete(args.eventId);return null;}
      if(['init_db','legacy_database_snapshot'].includes(command))return null;
      throw new Error('Unexpected native operation: '+command);
    }};
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}` });
  await waitFor('!!document.querySelector(".nav-list")');
  await waitFor(`!!${card} && window.__listenerCount('encoder-data') === 1`);
  assert.equal(await evaluate(`window.__listenerCount('fusion-data')`), 1);
  const sourceRegistrations = await evaluate(`window.__calls.filter(c=>c.command==='plugin:event|listen' && ['encoder-data','fusion-data'].includes(c.args.event)).map(c=>c.args.event)`);
  assert.match(await evaluate(`${card}.textContent`), /Drivetrain Monitoring/);
  assert.match(await evaluate(`${card}.textContent`), /No Data/);
  await navigate('Field Map');
  await waitFor(`!!${card} && window.__listenerCount('encoder-data') === 1`);
  assert.match(await evaluate(`${card}.textContent`), /No Data/);
  await emit('rx-board-connection', { connected: true, port: 'mock-receiver', mode: 'RX', revision: 1 });
  await waitFor(state('No Data'));
  await emit('sensor-data', sensor);
  await waitFor(`document.querySelector('.card-title').textContent.length > 0`);
  const sensorCard = `Array.from(document.querySelectorAll('.card')).find(el=>el.querySelector('.card-title')?.textContent==='Live Rover Telemetry')`;
  const originalSensor = await evaluate(`${sensorCard}.textContent`);
  await emitEncoder(0);
  await waitFor(state('Receiving'));
  assert.match(await evaluate(`${card}.textContent`), /Stopped/);
  await emitEncoder(2);
  await waitFor(`${card}.textContent.includes('-44.97')`);
  assert.equal(await evaluate(`${sensorCard}.textContent`), originalSensor);
  assert.equal(await evaluate(`window.__calls.some(c=>c.command==='database_execute')`), false);
  const signature = () => evaluate(`(()=>{const el=${card};return [...el.querySelectorAll('.drivetrain-telemetry__motor')].map(m=>m.textContent).join('|')+'|'+[...el.querySelectorAll('.drivetrain-telemetry__metrics > div')].filter(row=>['RPM difference','Age at transmit','Encoder sequence'].includes(row.querySelector('dt').textContent)).map(row=>row.textContent).join('|')+'|'+el.querySelector('[role=status]').textContent;})()`);
  const mapReading = await signature();
  await navigate('Live Monitoring');
  await waitFor(`!!document.querySelector('.rpm-history svg') && !!${card}`);
  assert.equal(await signature(), mapReading, 'Dashboard must reuse the accepted Field Map packet without another event');
  assert.equal(await evaluate(`window.__listenerCount('encoder-data')`), 1);
  // Encoder events must leave the dashboard soil KPIs and GPS status intact.
  const dashboardSensor = await evaluate(`document.querySelector('.kpi-row').textContent + document.querySelector('.status-badges').textContent`);
  await emitEncoder(2, { encoderSeq: 177 });
  await waitFor(`${card}.textContent.includes('177')`);
  assert.equal(await evaluate(`document.querySelector('.kpi-row').textContent + document.querySelector('.status-badges').textContent`), dashboardSensor);
  assert.equal(await evaluate(`window.__calls.some(c=>c.command==='database_execute')`), false);
  const dashboardReading = await signature();
  await navigate('Field Map');
  await waitFor(`!!${card} && ${card}.textContent.includes('177')`);
  assert.equal(await signature(), dashboardReading);
  assert.equal(await evaluate(`document.querySelector('.rpm-history')`), null, 'Field Map retains its compact card');
  // Malformed encoder events do not replace the last valid event.
  await emit('encoder-data', { type: 'encoder', leftRPM: 'bad' });
  assert.match(await evaluate(`${card}.textContent`), /-44\.97/);
  await emitEncoder(4);
  await waitFor(state('Stale'));
  assert.doesNotMatch(await evaluate(`${card}.textContent`), /-30\.00|\+60\.00/);
  await emitEncoder(3);
  await waitFor(state('Receiving'));
  await waitFor(state('Stale'));
  assert.doesNotMatch(await evaluate(`${card}.textContent`), /-30\.00|\+60\.00/);
  await emitEncoder(1);
  await waitFor(state('Receiving'));
  // Changing the threshold keeps the accepted packet.
  await evaluate(`{const select=${card}.querySelector('select');select.value='5000';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await waitFor(`${card}.textContent.includes('+45.00')`);
  await emit('rx-board-connection', { connected: false, port: null, mode: null, revision: 2 });
  await waitFor(state('Disconnected'));
  assert.doesNotMatch(await evaluate(`${card}.textContent`), /\+45\.00/);
  await emit('rx-board-connection', { connected: true, port: 'mock-receiver', mode: 'RX', revision: 3 });
  await waitFor(state('No Data'));
  await emitEncoder(0, { encoderSeq: 0 });
  await waitFor(state('Receiving'));
  for (const [width, height] of [[1366,900], [1024,768], [800,600]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`${card}.scrollIntoView({block:'center'})`);
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
    const bounds = await evaluate(`(()=>{const el=${card},r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth};})()`);
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= bounds.client + 1, `Card overflows at ${width}: ${JSON.stringify(bounds)}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, `drivetrain-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  await navigate('Live Monitoring');
  await waitFor(`!!document.querySelector('.rpm-history svg')`);
  assert.equal(await evaluate(`window.__listenerCount('encoder-data')`), 1);
  assert.equal(await evaluate(`${card}.querySelector('select').value`), '5000', 'Stale setting must be shared across tabs');
  for (const [width, height] of [[1366,900], [1024,768], [800,600]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`${card}.scrollIntoView({block:'center'})`);
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
    const bounds = await evaluate(`(()=>{const el=${card},r=el.getBoundingClientRect();return {left:r.left,right:r.right,scroll:el.scrollWidth,client:el.clientWidth};})()`);
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= bounds.client + 1, `Dashboard card overflows at ${width}: ${JSON.stringify(bounds)}`);
    assert.ok(await evaluate(`document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1`), `Dashboard workspace overflows at ${width}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, `dashboard-drivetrain-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  // Freshness advances through navigation; it is never reset by mounting a view.
  await waitFor(state('Stale'));
  await navigate('Field Map');
  await waitFor(`!!${card}`);
  await waitFor(state('Stale'));
  await navigate('Live Monitoring');
  await waitFor(`!!document.querySelector('.rpm-history')`);
  await emitEncoder(1, { encoderSeq: 180 });
  await waitFor(state('Receiving'));
  await navigate('Reports');
  await waitFor(`!${card}`);
  assert.equal(await evaluate(`window.__listenerCount('encoder-data')`), 1, 'Collection continues without either view mounted');
  await emitEncoder(1, { encoderSeq: 181 });
  await navigate('Field Map');
  await waitFor(`window.__listenerCount('encoder-data') === 1 && !!${card}`);
  await waitFor(`${card}.textContent.includes('181')`);
  await waitFor(state('Receiving'));
  // Smoke the existing GIS/dashboard, crop assessment and reports routes.
  for (const route of ['Live Monitoring', 'Crop Assessment', 'Reports', 'Field Map']) {
    await navigate(route);
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
  }
  // Reproduce the supplied A2.7 capture: DATA/FUS exist, standalone ENC is absent.
  await emit('rx-board-connection', { connected: false, port: null, mode: null, revision: 4 });
  await waitFor(state('Disconnected'));
  await emit('rx-board-connection', { connected: true, port: 'mock-receiver', mode: 'RX', revision: 5 });
  await waitFor(state('No Data'));
  await evaluate(`window.__emit('fusion-data', {...${JSON.stringify(actualFusion)},receivedAtMs:Date.now()})`);
  await waitFor(state('Receiving'));
  assert.match(await evaluate(`${card}.textContent`), /Fusion fallback/);
  assert.match(await evaluate(`${card}.textContent`), /No ENC counter data/);
  assert.equal(await evaluate(`${card}.querySelector('.drivetrain-telemetry__motor dd').textContent`), '—');
  const fusionReading = await signature();
  await navigate('Live Monitoring');
  await waitFor(`!!document.querySelector('.rpm-history')`);
  assert.equal(await signature(), fusionReading);
  const dashboardBeforeFusion = await evaluate(`document.querySelector('.kpi-row').textContent + document.querySelector('.status-badges').textContent`);
  await evaluate(`window.__emit('fusion-data', {...${JSON.stringify(actualFusion)},fusionSeq:913,leftRPM:12,rightRPM:13,lat:1,lng:1,soilValid:1,receivedAtMs:Date.now()})`);
  await waitFor(`${card}.textContent.includes('+12.00')`);
  assert.equal(await evaluate(`document.querySelector('.kpi-row').textContent + document.querySelector('.status-badges').textContent`), dashboardBeforeFusion);
  // A stale ENC packet may supply historical counts, but must not replace fresh fusion RPM.
  await emitEncoder(2, { encoderSeq: 200, receivedAtMs: Date.now() - 6000 });
  await waitFor(`${card}.textContent.includes('ENC counter readings are stale')`);
  assert.match(await evaluate(`${card}.textContent`), /Fusion fallback/);
  assert.match(await evaluate(`${card}.textContent`), /\+12\.00/);
  assert.match(await evaluate(`${card}.textContent`), /13,501/);
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`${card}.scrollIntoView({block:'center'})`);
  await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
  const fallbackScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'dashboard-fusion-rpm-stale-counters.png'), Buffer.from(fallbackScreenshot.data, 'base64'));
  await emitEncoder(1, { encoderSeq: 201 });
  await waitFor(`${card}.textContent.includes('Standalone ENC') && ${card}.textContent.includes('+45.00')`);
  await evaluate(`window.__emit('fusion-data', {...${JSON.stringify(actualFusion)},fusionSeq:914,encoderValid:0,receivedAtMs:Date.now()})`);
  assert.match(await evaluate(`${card}.textContent`), /\+45\.00/, 'Invalid fusion cannot invalidate fresh standalone RPM');
  assert.equal(await evaluate(`window.__listenerCount('encoder-data')`), 1);
  assert.equal(await evaluate(`window.__listenerCount('fusion-data')`), 1);
  assert.deepEqual(await evaluate(`window.__calls.filter(c=>c.command==='plugin:event|listen' && ['encoder-data','fusion-data'].includes(c.args.event)).map(c=>c.args.event)`), sourceRegistrations, 'Navigation must not re-register source listeners');
  assert.equal(await evaluate(`window.__calls.some(c=>c.command==='database_execute')`), false);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'dashboard-fusion-source-check.png'), Buffer.from(screenshot.data, 'base64'));
  const unexpected = errors.filter(error => !error?.includes("Cannot read properties of undefined (reading 'save')"));
  assert.deepEqual(unexpected, []);
  console.log('PASS: one subscription per encoder/fusion stream, shared views, actual-log fusion RPM fallback, stale/missing ENC counters, ENC priority, invalid-fusion isolation, RPM history, stale/recovery, background collection, sensor/GPS isolation, no SQL writes, USB reconnect, both layouts at 1366/1024/800 and existing route smoke checks.');
  console.log(`Screenshots: ${output}`);
} finally {
  await closeBrowser?.().catch(() => {});
  socket?.close(); browser.kill();
  await server.close();
}
