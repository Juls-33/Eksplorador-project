// Real Chromium frame sampling; no native database, radio or tile downloads.
// Usage: node scripts/check-motion.mjs [--production]
// Set CHROME_PATH when Chrome/Chromium is not in a standard installation path.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createPortReservation } from 'node:net';
import { createServer, preview } from 'vite';
import react from '@vitejs/plugin-react';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'eksplorador-motion-check-'));
console.log(`Motion evidence directory: ${output}`);
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
assert.ok(browserPath, 'Set CHROME_PATH to an installed Chrome or Chromium executable');
const production = process.argv.includes('--production');
const reservation = createPortReservation();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = production
  ? await preview({ configFile: false, root, preview: { host: '127.0.0.1', port, strictPort: true } })
  : await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port, strictPort: true, watch: null } });
if (!production) await server.listen();
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}`;
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${join(output, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket, closeBrowser;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser startup timed out')), 20000);
    let stderr = '';
    browser.once('error', error => { clearTimeout(timeout); reject(error); });
    browser.stderr.on('data', data => { stderr += data; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0, session;
  const pending = new Map(), exceptions = [], consoleErrors = [], traces = {};
  function send(method, params = {}, sessionId = session) {
    return new Promise((resolve, reject) => {
      const id = ++sequence, timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
      pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      if (request.url.includes('nominatim.openstreetmap.org')) {
        const results = [{ place_id: 1, name: 'UI test landmark', display_name: 'UI test landmark, Manila, Philippines', lat: '14.6095', lon: '120.9895', type: 'landmark' }];
        void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(results)).toString('base64') });
      } else if (request.method === 'HEAD') void send('Fetch.fulfillRequest', { requestId, responseCode: 200 });
      else void send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  closeBrowser = () => send('Browser.close', {}, null);
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression: `(function () { return eval(${JSON.stringify(expression)}); })()`, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const frames = async (count = 2) => evaluate(`(async () => { for (let i = 0; i < ${count}; i++) await new Promise(requestAnimationFrame); })()`);
  const waitFor = async expression => { for (let i = 0; i < 180; i++) { if (await evaluate(expression)) return; await frames(); } throw new Error(`Timed out: ${expression}`); };
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await frames(2); };
  const tabAction = label => `document.querySelector('.nav-list [aria-label="${label}"]').click()`;
  const key = async (name, code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, ...(name === 'Enter' ? { text: '\r' } : name === ' ' ? { text: ' ' } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, windowsVirtualKeyCode: code }); await frames(2); };
  const sample = async (name, action, selector, count = 28) => {
    const samples = await evaluate(`(async () => {
      ${action}; const samples = [];
      for (let i = 0; i < ${count}; i++) {
        await new Promise(requestAnimationFrame);
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) { samples.push({time: performance.now(), opacity: 0, y: 0, height: 0, visibility: 'hidden', active: false, removed: true}); continue; }
        const s = getComputedStyle(el);
        const chevron = el.parentElement.querySelector('.disclosure-chevron');
        const rotation = chevron ? new DOMMatrixReadOnly(getComputedStyle(chevron).transform) : null;
        samples.push({ time: performance.now(), opacity: +s.opacity, y: s.transform === 'none' ? 0 : new DOMMatrixReadOnly(s.transform).m42, height: el.getBoundingClientRect().height, visibility: s.visibility, active: el.getAnimations().some(a => a.playState === 'running'), animationTime: el.getAnimations()[0]?.currentTime ?? null, inert: el.inert, buttons: el.querySelectorAll('button').length, angle: rotation ? Math.atan2(rotation.b, rotation.a) * 180 / Math.PI : null, nextTop: el.parentElement.nextElementSibling?.getBoundingClientRect().top ?? null });
      } return samples;
    })()`);
    traces[name] = samples;
    await writeFile(join(output, 'frames.json'), JSON.stringify(traces, null, 2));
    return samples;
  };
  const checkEntrance = samples => {
    assert.ok(samples[0].active, 'Entrance must be running immediately after navigation');
    assert.ok(samples.some(s => s.opacity > 0 && s.opacity < 1), 'Must render intermediate opacity');
    assert.ok(samples.some(s => s.y > 0), 'Must render nonzero translateY');
    assert.ok(Math.abs(samples.at(-1).opacity - 1) < .001 && Math.abs(samples.at(-1).y) < .01, 'Must finish fully visible at rest');
  };
  const screenshot = async name => { const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(output, `${name}.png`), Buffer.from(result.data, 'base64')); };
  await send('Page.enable'); await send('Page.bringToFront'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*openstreetmap.org*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    let next = 1; const callbacks = new Map(), events = new Map(); window.__calls = [];
    window.__emit = (event, payload) => { for (const value of events.values()) if (value.event === event) callbacks.get(value.handler)?.({ payload }); };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event, id) { events.delete(id); } };
    window.__TAURI_INTERNALS__ = { transformCallback(fn) { const id = next++; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc() { return '/no-ui-test-tile'; }, async invoke(command, args = {}) {
      window.__calls.push(command);
      if (command === 'database_select') return args.sql.includes('_app_meta') ? [{ value: '1' }] : [];
      if (command === 'get_recent_telemetry') return { records: [], generation: 0 };
      if (command === 'get_rx_board_connection') return { connected: false, port: null, mode: null, revision: 0 };
      if (command === 'plugin:event|listen') { const id = next++; events.set(id, args); return id; }
      if (command === 'plugin:path|resolve_directory') return 'C:/isolated-ui-test';
      if (command === 'plugin:path|join') return args.paths.join('/');
      if (command === 'plugin:fs|exists') return false;
      if (['init_db', 'legacy_database_snapshot', 'plugin:event|unlisten'].includes(command)) return null;
      throw new Error('Unexpected native operation: ' + command);
    } };
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.navigate', { url }); await waitFor(`!!document.querySelector('.nav-list')`); await frames(20);
    for (const [from, to] of [['Field Map', 'Live Monitoring'], ['Live Monitoring', 'Crop Assessment'], ['Crop Assessment', 'Reports'], ['Reports', 'Offline Maps'], ['Offline Maps', 'Field Map']]) {
      await evaluate(tabAction(from)); await frames(20);
      checkEntrance(await sample(`${from}-to-${to}`, tabAction(to), '.page-transition:not([hidden])'));
    }
    await sample('page-intermediate-capture', tabAction('Reports'), '.page-transition:not([hidden])', 4); await screenshot('page-entering'); await frames(20);
    await evaluate(tabAction('Live Monitoring')); await frames(20);
    const telemetry = await sample('telemetry-stays-still', `window.__emit('sensor-data', {soilValid:0,satsLocked:0,satsView:0})`, '.page-transition:not([hidden])', 4);
    assert.ok(telemetry.every(s => !s.active && s.opacity === 1 && s.y === 0));
    await sample('rapid-first', tabAction('Reports'), '.page-transition:not([hidden])', 3);
    const rapid = await sample('rapid-restart', tabAction('Offline Maps'), '.page-transition:not([hidden])'); checkEntrance(rapid); assert.ok(rapid[0].opacity < .6, 'Rapid navigation must restart the entrance');
    await evaluate(`window.__source = document.querySelector('.tile-manager-view'); window.__map = document.querySelector('.tile-manager-view .leaflet-container'); const input = document.querySelector('.tile-manager-view input[type=text]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Retained motion-test draft'); input.dispatchEvent(new Event('input', {bubbles:true}));`);
    checkEntrance(await sample('contextual-help', `document.querySelector('.tile-manager-view .help-button').click()`, '.page-transition:not([hidden])'));
    assert.equal(await evaluate(`document.querySelector('.manual-guide-nav [aria-pressed=true]').textContent`), 'Offline Map Guide');
    checkEntrance(await sample('contextual-back', `document.querySelector('.manual-back-button').click()`, '.page-transition:not([hidden])')); assert.ok(await evaluate(`document.querySelector('.tile-manager-view') === window.__source && document.querySelector('.tile-manager-view .leaflet-container') === window.__map && document.querySelector('.tile-manager-view input[type=text]').value === 'Retained motion-test draft'`));
    checkEntrance(await sample('direct-manual', tabAction('User Manual'), '.page-transition:not([hidden])'));
    await evaluate(`window.__topicNav = document.querySelector('.manual-topic-nav'); undefined`);
    checkEntrance(await sample('manual-topic', `document.querySelector('.manual-topic-nav button:nth-of-type(2)').click()`, '.manual-topic-content'));
    assert.ok(await evaluate(`document.querySelector('.manual-topic-nav') === window.__topicNav`));
    const trigger = `.manual-details:first-of-type .disclosure-trigger`;
    const panel = `.manual-details:first-of-type .disclosure-panel`;
    await waitFor(`!!document.querySelector('${trigger}')`);
    const opened = await sample('controller-open', `document.querySelector('${trigger}').click()`, panel);
    assert.ok(new Set(opened.filter(s => s.height > 0 && s.height < opened.at(-1).height - 1).map(s => s.height.toFixed(1))).size >= 4, 'Opening needs multiple distinct intermediate heights');
    assert.ok(opened.some(s => s.opacity > 0 && s.opacity < 1));
    assert.ok(opened.some(s => s.angle > 0 && s.angle < 179));
    assert.ok(Math.abs(Math.abs(opened.at(-1).angle) - 180) < .1);
    assert.ok(opened.at(-1).nextTop > opened[0].nextTop + 10, 'Following content must move down with expansion');
    const closed = await sample('controller-close', `document.querySelector('${trigger}').click()`, panel);
    assert.ok(new Set(closed.filter(s => s.height > 0 && s.height < closed[0].height).map(s => s.height.toFixed(1))).size >= 4, 'Closing needs multiple distinct intermediate heights');
    assert.equal(closed.at(-1).height, 0); assert.equal(closed.at(-1).visibility, 'hidden');
    assert.ok(closed.at(-1).nextTop < closed[0].nextTop - 10, 'Following content must move up during collapse');
    assert.ok(Math.abs(closed.at(-1).height - closed.at(-2).height) < .5, 'No end-of-collapse height jump');
    assert.ok(await evaluate(`(() => { const panel = document.querySelector('${panel}'); const link = panel.querySelector('a'); link.focus(); return panel.inert && panel.getAttribute('aria-hidden') === 'true' && document.activeElement !== link; })()`));
    await evaluate(`document.querySelector('${trigger}').focus()`); await key('Enter', 13); await frames(20); assert.equal(await evaluate(`document.querySelector('${trigger}').getAttribute('aria-expanded')`), 'true');
    await key(' ', 32); await frames(20); assert.equal(await evaluate(`document.querySelector('${trigger}').getAttribute('aria-expanded')`), 'false');
    await sample('disclosure-intermediate-capture', `document.querySelector('${trigger}').click()`, panel, 4); await screenshot('disclosure-opening'); await frames(24);
    await click('.manual-details:nth-of-type(2) .disclosure-trigger'); await waitFor(`[...document.querySelectorAll('.manual-details:nth-of-type(2) img')].every(img => img.complete && img.naturalWidth > 0)`); await frames(20);
    await click('.manual-details:nth-of-type(2) .manual-photo button'); await waitFor(`document.querySelector('.manual-lightbox').open`); await key('Escape', 27); await waitFor(`!document.querySelector('.manual-lightbox').open`);
    await evaluate(`document.querySelector('.manual-topic-nav button:last-of-type').click()`); await frames(20);
    await sample('troubleshooting-open', `document.querySelector('${trigger}').click()`, panel);
    const helpClosed = await sample('troubleshooting-close', `document.querySelector('${trigger}').click()`, panel); assert.equal(helpClosed.at(-1).height, 0);
    for (const [width, height] of [[1024, 768], [800, 600]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      if (width <= 900) await evaluate(`const select = document.querySelector('.manual-topic-select select'); select.value = '1'; select.dispatchEvent(new Event('change', {bubbles:true}))`);
      else await click('.manual-topic-nav button:nth-of-type(2)');
      if (await evaluate(`document.querySelector('${trigger}').getAttribute('aria-expanded') === 'true'`)) { await click(trigger); await frames(20); }
      await evaluate(`document.querySelector('${trigger}').scrollIntoView({block:'start'})`);
      await frames(20); const narrow = await sample(`disclosure-${width}`, `document.querySelector('${trigger}').click()`, panel); assert.ok(narrow.some(s => s.height > 0 && s.height < narrow.at(-1).height)); await screenshot(`manual-${width}`);
      assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    }
    await evaluate(tabAction('Offline Maps')); await frames(22);
    const search = `.tile-manager-view input[aria-label="Search a place or landmark"]`;
    await evaluate(`const input = document.querySelector('${search}'); input.scrollIntoView({block:'center'}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'UI test landmark'); input.dispatchEvent(new Event('input', {bubbles:true}));`); await frames(2);
    const menuOpen = await sample('menu-open', `document.querySelector('.tile-manager-view form[role=search] button[type=submit]').click()`, '.animated-menu');
    assert.ok(menuOpen.some(s => s.active && s.opacity > 0 && s.opacity < 1));
    assert.ok(await evaluate(`document.querySelector('.animated-menu').parentElement.classList.contains('dashboard-layout')`));
    assert.ok(await evaluate(`(() => {const r = document.querySelector('.animated-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;})()`));
    await evaluate(`document.querySelector('.tile-manager-view form[role=search] button[type=submit]').focus()`); await key('Tab', 9);
    assert.ok(await evaluate(`document.querySelector('.animated-menu').contains(document.activeElement)`), 'Tab from Go must reach the portaled results');
    await evaluate(`document.querySelector('${search}').focus()`); await key('ArrowDown', 40);
    assert.ok(await evaluate(`document.querySelector('.animated-menu').contains(document.activeElement)`));
    const menuClose = await sample('menu-close', `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`, '.animated-menu');
    assert.ok(menuClose.some(s => !s.removed && s.opacity > 0 && s.opacity < 1)); assert.ok(menuClose.at(-1).removed);
    assert.ok(menuClose.some(s => s.active && s.inert && s.buttons > 0), 'Closing results must remain rendered but inaccessible');
    assert.ok(await evaluate(`document.activeElement === document.querySelector('${search}')`));
    await click('.tile-manager-view form[role=search] button[type=submit]'); await waitFor(`!!document.querySelector('.animated-menu')`); await frames(15);
    await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`); await frames(20); assert.equal(await evaluate(`document.querySelector('.animated-menu')`), null);
    await click('.tile-manager-view form[role=search] button[type=submit]'); await waitFor(`!!document.querySelector('.animated-menu')`);
    await click('.tile-manager-view .help-button'); await frames(20);
    assert.equal(await evaluate(`document.querySelector('.animated-menu')`), null, 'A hidden source page cannot leave a portal over Help');
    await click('.manual-back-button'); await frames(20);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await sample('reduced-page', tabAction('Offline Maps'), '.page-transition:not([hidden])', 4); assert.ok(reduced.every(s => s.opacity === 1 && s.y === 0 && !s.active));
    await evaluate(`const input = document.querySelector('${search}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'UI test landmark'); input.dispatchEvent(new Event('input', {bubbles:true}));`); await frames(2);
    await click('.tile-manager-view form[role=search] button[type=submit]'); await waitFor(`!!document.querySelector('.animated-menu')`);
    assert.ok(await evaluate(`document.querySelector('.animated-menu').getAnimations().length === 0 && getComputedStyle(document.querySelector('.animated-menu')).opacity === '1'`));
    await evaluate(`document.querySelector('${search}').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`); await frames(2); assert.equal(await evaluate(`document.querySelector('.animated-menu')`), null);
    await evaluate(tabAction('User Manual')); await frames(2); await evaluate(`const select = document.querySelector('.manual-topic-select select'); select.value = '1'; select.dispatchEvent(new Event('change', {bubbles:true}))`); await frames(2);
    const reducedOpen = await sample('reduced-disclosure', `document.querySelector('${trigger}').click()`, panel, 4); assert.ok(reducedOpen.every(s => s.height === reducedOpen.at(-1).height && s.opacity === 1));
    const reducedClose = await sample('reduced-disclosure-close', `document.querySelector('${trigger}').click()`, panel, 4); assert.ok(reducedClose.every(s => s.height === 0 && s.opacity === 0 && s.visibility === 'hidden'));
    assert.deepEqual(consoleErrors, []);
    const unexpected = exceptions.filter(item => production || !item.exception?.description.includes("Cannot read properties of undefined (reading 'save')") || !item.url.includes('leaflet'));
    assert.equal(unexpected.length, 0, unexpected.map(item => item.exception?.description).join('\n'));
    console.log('PASS: page replay, intermediate opacity/translation, disclosure opening/closing heights, custom menu entrance/exit, Help/Back state, keyboard, lightbox, laptop layouts and reduced motion');
    console.log(`Runtime exceptions: ${exceptions.length} known development Leaflet teardown; ${unexpected.length} unexpected`);
  await writeFile(join(output, 'frames.json'), JSON.stringify(traces, null, 2));
  console.log(`Frame traces and screenshots: ${output}`);
} finally {
  await closeBrowser?.().catch(() => {});
  socket?.close(); browser.kill();
  if (production) await new Promise(resolve => server.httpServer.close(resolve)); else await server.close();
}
