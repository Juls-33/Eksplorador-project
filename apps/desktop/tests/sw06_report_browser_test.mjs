// MTP-SW-06 browser PDF verification (v4: fix nested-template-string PRAGMA matcher). Copy to apps/desktop/tests/sw06_report_browser_test.mjs.
// Requires Vite running at http://127.0.0.1:1420 and separate headless Chrome with CDP port 9226.
// Chrome is isolated by a fresh --user-data-dir; ALL Tauri IPC calls are mocked in this page.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.SW06_URL || 'http://127.0.0.1:1420/';
const DEBUG = process.env.SW06_DEBUG_URL || 'http://127.0.0.1:9226';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  let targets;
  for (let retry = 0; retry < 30; retry++) {
    try {
      const res = await fetch(`${DEBUG}/json`);
      targets = await res.json();
      if (targets.some(t => t.type === 'page')) break;
    } catch {}
    await delay(250);
  }
  assert.ok(targets?.some(t => t.type === 'page'), `No Chrome CDP page at ${DEBUG}. Start isolated Chrome on port 9226.`);
  const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    if (!reply.id || !pending.has(reply.id)) return;
    const p = pending.get(reply.id);
    pending.delete(reply.id);
    if (reply.error) p.reject(new Error(reply.error.message));
    else p.resolve(reply.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { socket, call, evaluate };
}

const { socket, call, evaluate } = await connect();
try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
  (() => {
    const records = [
      {id:1,mission_id:10,sample_session_id:'S1',timestamp:'2026-11-18T08:00:00Z',latitude:14.6094,longitude:120.9896,location_source:'GPS',ph:6,moisture:30,ec:400,nitrogen:20,phosphorus:15,potassium:40},
      {id:2,mission_id:10,sample_session_id:'S2',timestamp:'2026-11-18T08:05:00Z',latitude:null,longitude:null,location_source:'UNLOCATED',ph:8,moisture:50,ec:600,nitrogen:30,phosphorus:20,potassium:50},
      {id:3,mission_id:10,sample_session_id:null,timestamp:'2026-11-18T08:10:00Z',latitude:null,longitude:null,ph:null,moisture:45,ec:null,nitrogen:null,phosphorus:null,potassium:null},
      {id:4,mission_id:10,sample_session_id:null,timestamp:'2026-11-18T08:15:00Z',latitude:null,longitude:null,ph:null,moisture:150,ec:null,nitrogen:null,phosphorus:null,potassium:null}
    ];
    const field = {id:1,name:'SW06 Test Field',soil_type:'Loam',boundary_geojson:null,mission_count:1};
    const mission = {id:10,field_id:1,field_name:'SW06 Test Field',name:'SW06 Test Mission',mission_date:'2026-11-18',status:'completed',pins_geojson:null};
    const crop = {id:1,name:'SW06 Test Crop',category:'Test',notes:'Synthetic SW06 fixture',compatible_soil_types:'["Loam"]',min_ph:5.5,max_ph:7.0};
    const callbacks = new Map();
    const listeners = new Map();
    let callbackId = 0;
    window.SW06_MOCK_ACTIVE = true;
    window.SW06_CALLS = [];
    window.SW06_QUERIES = [];
    window.SW06_MATCHES = [];
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
    window.__TAURI_INTERNALS__ = {
      transformCallback(fn) { callbacks.set(++callbackId, fn); return callbackId; },
      convertFileSrc: v => v,
      async invoke(command, args={}) {
        window.SW06_CALLS.push(command);
        if (command === 'plugin:event|listen') {listeners.set(args.event, [...(listeners.get(args.event)||[]), args.handler]);return args.handler;}
        if (command === 'plugin:event|unlisten') return;
        if (command === 'get_recent_telemetry') return {records:[],generation:1};
        if (command === 'database_status') return {total:records.length};
        if (command === 'get_rx_board_connection') return {connected:false,mode:'RX',revision:1};
        if (command === 'database_execute') return {rowsAffected:0,lastInsertId:null};
        if (command === 'database_select') {
          const sql = String(args.sql ?? args.query ?? args.statement ?? '');
          const normalized = sql.replace(/\\s+/g, ' ').trim().toLowerCase();
          let kind = 'UNMATCHED';
          let result = [];
          // Schema inspection runs during database initialization. Return the
          // synthetic table's columns; an empty PRAGMA response means the
          // application assumes the table/required columns are missing.
          // Avoid a nested-template-literal regex escaping trap: the source
          // here is itself injected into Chrome as JavaScript text.
          const schemaTables = ['fields', 'crop_profiles', 'missions', 'telemetry'];
          const schemaTable = schemaTables.find(table =>
            normalized.startsWith('pragma table_info(' + table + ')') ||
            normalized.startsWith('pragma table_info("' + table + '")') ||
            normalized.startsWith("pragma table_info('" + table + "')")
          );
          if (schemaTable) {
            const columnsByTable = {
              fields: ['id','name','soil_type','boundary_geojson','created_at','updated_at'],
              crop_profiles: ['id','name','category','notes','compatible_soil_types','min_ph','max_ph','min_moisture','max_moisture','min_ec','max_ec','min_n','max_n','min_p','max_p','min_k','max_k'],
              missions: ['id','field_id','field_name','name','mission_date','status','pins_geojson'],
              telemetry: ['id','mission_id','plot','timestamp','latitude','longitude','ph','moisture','ec','nitrogen','phosphorus','potassium','overall','location_source','sample_session_id']
            };
            kind = 'schema_' + schemaTable;
            result = (columnsByTable[schemaTable] || []).map((name, cid) => ({cid, name, type:'TEXT', notnull:0, dflt_value:null, pk:name==='id'?1:0}));
          } else if (normalized.includes('from crop_profiles')) {
            kind = 'crop_profiles'; result = [crop];
          } else if (normalized.includes('from fields f')) {
            kind = 'fields'; result = [field];
          } else if (normalized.includes('from missions m')) {
            kind = 'missions'; result = [mission];
          } else if (normalized.includes('from telemetry') && normalized.includes('group by mission_id')) {
            kind = 'mission_counts'; result = [{mission_id:10,total:4}];
          } else if (normalized.includes('from telemetry')) {
            kind = 'telemetry'; result = records;
          }
          window.SW06_QUERIES.push({sql:sql.slice(0,350),argsKeys:Object.keys(args),kind,count:result.length});
          window.SW06_MATCHES.push(kind);
          return result;
        }
        return null;
      }
    };
  })();
  ` });
  await call('Page.navigate', { url: BASE });
  let reportReady = false;
  for (let i = 0; i < 100; i++) {
    const result = await evaluate(`(() => ({mock:!!window.SW06_MOCK_ACTIVE,report:!!document.querySelector('.report-paper'),nav:!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reports'),body:document.body?.innerText?.slice(0,200)}))()`);
    if (result.report) { reportReady = true; break; }
    if (result.nav) {
      await evaluate(`(() => {[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reports')?.click();return true})()`);
    }
    await delay(200);
  }
  if (!reportReady) {
    const diagnostic = await evaluate(`({mock:!!window.SW06_MOCK_ACTIVE,commands:window.SW06_CALLS?.slice(-25),queries:window.SW06_QUERIES?.slice(-15),body:document.body?.innerText?.slice(0,1400)})`);
    throw new Error('Report did not render. Diagnostics: ' + JSON.stringify(diagnostic));
  }
  const sqlMatches = await evaluate(`window.SW06_MATCHES || []`);
  assert.ok(sqlMatches.includes('telemetry'), 'Synthetic telemetry SELECT was not handled');
  assert.ok(sqlMatches.includes('fields'), 'Synthetic fields SELECT was not handled');
  assert.ok(sqlMatches.includes('missions'), 'Synthetic missions SELECT was not handled');
  console.log('PASS: Mock routed telemetry, field and mission database queries');
  const text = await evaluate(`document.querySelector('.report-paper').innerText`);
  const expected = [
    'SW06 Test Field', 'SW06 Test Crop', 'Recorded Soil Conditions (3 samples)',
    '41.7%', '7.00', '0.500 dS/m', '25 mg/kg',
    '1/2 valid pH readings match', 'Not geotagged', 'Legacy / unlinked',
    'N/A', '2/3', 'Sensor estimate', 'not laboratory ECe'
  ];
  for (const phrase of expected) {
    assert.ok(text.includes(phrase), `Rendered report missing: ${JSON.stringify(phrase)}`);
    console.log('PASS rendered report:', phrase);
  }
  const commands = await evaluate('window.SW06_CALLS');
  assert.ok(!commands.some(c => /send_mission|serial_write|send_movement|confirm_mission_deployment/.test(c)), 'Unexpected movement/transmission IPC');
  console.log('PASS: No movement or radio-transmission commands were invoked');

  // Print the actual React .report-paper with its @media print CSS.
  const output = await call('Page.printToPDF', {
    printBackground: true, preferCSSPageSize: true, transferMode: 'ReturnAsBase64'
  });
  const pdf = Buffer.from(output.data || '', 'base64');
  assert.ok(pdf.length > 1000 && pdf.subarray(0, 5).toString() === '%PDF-', 'Invalid or empty generated PDF');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eksplorador-sw06-'));
  const pdfPath = path.join(dir, 'sw06-synthetic-field-report.pdf');
  const manifestPath = path.join(dir, 'sw06-rendered-report.txt');
  await writeFile(pdfPath, pdf);
  await writeFile(manifestPath, text, 'utf8');
  console.log('PASS: Actual React Reports page printed successfully');
  console.log('PDF:', pdfPath);
  console.log('Rendered text verification:', manifestPath);
  console.log('SW06 browser checks: ' + (expected.length + 3) + '/' + (expected.length + 3) + ' PASS');
  console.log('NOTE: Text assertions checked rendered report, not parsed PDF text. Open PDF and inspect pages before marking PDF comparison PASS.');
} finally {
  socket.close();
}
