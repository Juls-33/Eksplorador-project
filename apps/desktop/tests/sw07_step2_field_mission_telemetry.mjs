// MTP-SW-07 Steps 1-2: field creation, mission and live telemetry through real React+Leaflet UI with mocked Tauri IPC.
// Requires Vite on 127.0.0.1:1420 and an ISOLATED Chrome CDP page on port 9226.
// NEVER connects to production SQLite or rover hardware.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.SW07_URL || 'http://127.0.0.1:1420/';
const DEBUG = process.env.SW07_DEBUG_URL || 'http://127.0.0.1:9226';
const delay = ms => new Promise(r => setTimeout(r, ms));
const dir = await mkdtemp(path.join(os.tmpdir(), 'eksplorador-sw07-step2-'));

const targets = await (await fetch(`${DEBUG}/json`)).json();
const page = targets.find(t => t.type === 'page');
assert.ok(page, 'No isolated Chrome page found. Launch Chrome with --remote-debugging-port=9226.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const handlers = pending.get(msg.id); pending.delete(msg.id);
  msg.error ? handlers.reject(new Error(msg.error.message)) : handlers.resolve(msg.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId; pending.set(id, {resolve,reject});
  socket.send(JSON.stringify({id,method,params}));
});
const evalJs = async expression => {
  const res = await call('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true});
  if (res.exceptionDetails) throw Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
};
const waitFor = async (expr, msg) => {
  for (let i=0; i<100; i++) { if (await evalJs(expr)) return; await delay(200); }
  const diag = await evalJs(`({body:document.body?.innerText?.slice(0,1800),calls:window.SW07_CALLS?.slice(-25),queries:window.SW07_QUERIES?.slice(-20)})`);
  throw Error(`${msg} -- ${JSON.stringify(diag)}`);
};
const clickText = async label => {
  const ok = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)} && !x.disabled); if(!b)return false;b.click();return true;})()`);
  assert.ok(ok, 'Enabled button missing: '+label);
};
const screenshot = async name => {
  const data = await call('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  await writeFile(path.join(dir,name),Buffer.from(data.data,'base64'));
};

try {
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `
    (() => {
      let fields = [], missions = [], telemetry = [], rawReadings = [];
      let nextFieldId = 1, nextMissionId = 10;
      const callbacks=new Map(),listeners=new Map();let nextCallback=0;
      window.SW07_MOCK_ACTIVE=true;
      window.SW07_CALLS=[];window.SW07_QUERIES=[];window.SW07_WRITES=[];
      window.SW07_GET_STATE=()=>({fields,missions,telemetry,rawReadings});
      window.SW07_EMIT=(event,payload)=>{ for(const handlerId of (listeners.get(event)||[])) {const cb=callbacks.get(handlerId);if(typeof cb==='function')cb({event,id:handlerId,payload});} };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
      window.__TAURI_INTERNALS__={
        transformCallback(fn){callbacks.set(++nextCallback,fn);return nextCallback;},
        convertFileSrc(x){return x;},
        async invoke(command,args={}){
          window.SW07_CALLS.push(command);
          if(/send_movement|send_mission|serial_write|confirm_mission_deployment|prepare_mission_deployment|send_movement_sequence|set_rx_board_mode/.test(command))
            throw Error('SW07 safety block: unexpected hardware or radio IPC: '+command);
          if(command==='plugin:event|listen') {listeners.set(args.event,[...(listeners.get(args.event)||[]),args.handler]);return args.handler;}
          if(command==='plugin:event|unlisten')return;
          if(command==='get_recent_telemetry')return {records:[],generation:1};
          if(command==='get_rx_board_connection')return {connected:false,mode:'RX',revision:1};
          if(command==='database_status')return {total:telemetry.length};
          if(command==='init_db')return;
          if(command==='database_execute'){
            const sql=String(args.sql||''); const low=sql.replace(/\\s+/g,' ').trim().toLowerCase();
            window.SW07_WRITES.push({sql:sql.slice(0,400),values:args.values||[]});
            if(low.startsWith('insert into missions')){
              const v=args.values||[];
              const row={id:nextMissionId++,field_id:Number(v[0]),name:String(v[1]),mission_date:v[2],pins_geojson:v[3],status:'in_progress'};
              missions.push(row);return {rowsAffected:1,lastInsertId:row.id};
            }
            if(low.startsWith('insert into mission_soil_readings')){
              const v=args.values||[];rawReadings.push({session_id:v[0],mission_id:Number(v[1]),received_at:v[2],latitude:v[3],longitude:v[4],moisture:v[5],ph:v[6],ec:v[7],nitrogen:v[8],phosphorus:v[9],potassium:v[10],soil_valid:v[11]});
              return {rowsAffected:1,lastInsertId:rawReadings.length};
            }
            if(low.startsWith('insert into fields')){
              const row={id:nextFieldId++,name:args.values[0],boundary_geojson:args.values[1],soil_type:null,mission_count:0};
              fields.push(row);return {rowsAffected:1,lastInsertId:row.id};
            }
            return {rowsAffected:0,lastInsertId:null};
          }
          if(command==='database_select'){
            const sql=String(args.sql||'');const low=sql.replace(/\\s+/g,' ').trim().toLowerCase();
            let kind='UNMATCHED',result=[];
            const table=['fields','crop_profiles','missions','telemetry'].find(t=>low.startsWith('pragma table_info('+t+')'));
            if(table){
              const cols={fields:['id','name','soil_type','boundary_geojson','created_at','updated_at'],crop_profiles:['id','name','min_ph','max_ph','compatible_soil_types'],missions:['id','field_id','field_name','mission_date','status','pins_geojson'],telemetry:['id','mission_id','latitude','longitude','moisture','ph','ec','nitrogen','phosphorus','potassium','sample_session_id']};
              kind='schema_'+table;result=cols[table].map((name,cid)=>({cid,name,type:'TEXT',notnull:0,dflt_value:null,pk:name==='id'?1:0}));
            } else if(low.includes('from fields f')){kind='all_fields';result=fields.map(f=>({...f,mission_count:missions.filter(m=>m.field_id===f.id).length}));}
            else if(low.includes('from fields') && low.includes('where id')){kind='field_by_id';result=fields.filter(f=>f.id===Number(args.values?.[0]));}
            else if(low.includes('from fields')){kind='fields';result=fields;}
            else if(low.includes('from missions m')){kind='missions';result=missions.map(m=>({...m,field_name:fields.find(f=>f.id===m.field_id)?.name||''}));}
            else if(low.includes('from missions') && low.includes('where id')){kind='mission_by_id';result=missions.filter(m=>m.id===Number(args.values?.[0])).map(m=>({...m,field_name:fields.find(f=>f.id===m.field_id)?.name||''}));}
            else if(low.includes('from missions')){kind='missions';result=missions;}
            else if(low.includes('from crop_profiles')){kind='crops';result=[];}
            else if(low.includes('from mission_soil_readings')){kind='raw';result=rawReadings.filter(r=>r.mission_id===Number(args.values?.[0]));}
            else if(low.includes('from telemetry')){kind='telemetry';result=[];}
            window.SW07_QUERIES.push({sql:sql.slice(0,250),kind,count:result.length});
            return result;
          }
          return null;
        }
      };
    })();
  `});
  await call('Page.navigate', {url:BASE});
  await waitFor(`!!document.querySelector('button') && !!window.SW07_MOCK_ACTIVE`, 'UI and mock did not initialize');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Field Map')`, 'Field Map navigation missing');
  await clickText('Field Map');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add Field')`, 'Field Map not ready');
  await screenshot('01_field_map_before.png');
  await clickText('Add Field');
  await waitFor(`!!document.querySelector('input[placeholder="e.g., UST Field"]')`, 'Add Field modal missing');
  await evalJs(`(() => {const el=document.querySelector('input[placeholder="e.g., UST Field"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'SW07 Test Field');el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Next: Draw Field Boundary' && !b.disabled)`, 'Field name not accepted');
  await clickText('Next: Draw Field Boundary');
  await waitFor(`document.body.innerText.includes('Drawing boundary: SW07 Test Field')`, 'Boundary wizard did not start');
  await waitFor(`!!document.querySelector('.leaflet-container')`, 'Leaflet container missing');
  await delay(800);
  // Real DevTools pointer events: Leaflet computes and forwards [latitude,longitude].
  const rect = await evalJs(`(() => {const r=document.querySelector('.leaflet-container').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  assert.ok(rect.w>=180&&rect.h>=180, 'Map container too small for actual clicks');
  for(const [fx,fy] of [[.37,.43],[.59,.43],[.49,.64]]){
    const x=Math.round(rect.x+rect.w*fx),y=Math.round(rect.y+rect.h*fy);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    await delay(300);
  }
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/Save Field \\(3 points\\)/.test(b.textContent) && !b.disabled)`, 'Three boundary clicks not registered');
  await screenshot('02_boundary_three_points.png');
  const saved = await evalJs(`(() => {const b=[...document.querySelectorAll('button')].find(x=>/Save Field \\(3 points\\)/.test(x.textContent)&&!x.disabled);if(!b)return false;b.click();return true})()`);
  assert.ok(saved,'Save Field button inaccessible');
  await waitFor(`window.SW07_GET_STATE().fields.length===1`, 'Field INSERT did not happen');
  await waitFor(`document.body.innerText.includes('Field "SW07 Test Field" saved.')`, 'Field save confirmation absent');
  const state=await evalJs(`window.SW07_GET_STATE()`);
  const polygon=JSON.parse(state.fields[0].boundary_geojson);
  assert.equal(state.fields[0].name,'SW07 Test Field');
  assert.equal(polygon.type,'Polygon');
  assert.ok(polygon.coordinates[0].length>=4,'Expected a closed polygon from 3 map clicks');
  const selector=await evalJs(`(() => [...document.querySelectorAll('select[aria-label="Filter missions by field"] option')].map(o=>o.textContent))()`);
  assert.ok(selector.some(s=>s.includes('SW07 Test Field')),'Saved field not in field navigation');
  const unsafe=await evalJs(`window.SW07_CALLS.filter(c=>/send_movement|send_mission|serial_write|confirm_mission_deployment|prepare_mission_deployment|set_rx_board_mode/.test(c))`);
  assert.deepEqual(unsafe,[]);
  await screenshot('03_field_saved.png');
  await writeFile(path.join(dir,'sw07_step1_evidence.json'),JSON.stringify({field:state.fields[0],selector,unsafeCalls:unsafe},null,2));
  console.log('PASS: Add Field modal and name input');
  console.log('PASS: Actual Leaflet map clicks created 3 boundary points');
  console.log('PASS: Mock database stored field with closed GeoJSON polygon');
  console.log('PASS: Saved field displayed in field selector');
  console.log('PASS: No hardware or mission transmission calls');
  console.log('SW07 Step 1 browser checks: 5/5 PASS');

  // Step 2: create a mission through actual form and map interactions.
  await clickText('Start New Mission');
  await waitFor(`!!document.querySelector('input[placeholder="e.g., UST Field October Scan"]')`, 'Mission modal missing');
  await evalJs(`(() => {const el=document.querySelector('input[placeholder="e.g., UST Field October Scan"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,'SW07 Test Mission'); el.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  const modal = await evalJs(`(() => [...document.querySelectorAll('.ui-dialog')].map(x=>({text:x.innerText.slice(-1200),buttons:[...x.querySelectorAll('button')].map(b=>({text:b.innerText,disabled:b.disabled}))})))()`);
  await writeFile(path.join(dir,'mission_modal_diagnostic.json'),JSON.stringify(modal,null,2));
  const nextButtons=await evalJs(`(() => [...document.querySelectorAll('.ui-dialog button')].filter(b=>!b.disabled).map(b=>b.innerText.trim()))()`);
  const next=nextButtons.find(v=>/next|place|continue|start/i.test(v));
  assert.ok(next, 'Mission next button not found. Review mission_modal_diagnostic.json');
  await clickText(next);
  await waitFor(`document.body.innerText.includes('Placing waypoints: SW07 Test Field')`, 'Mission waypoint wizard not started');
  await delay(700);
  const r2=await evalJs(`(() => {const r=document.querySelector('.leaflet-container').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  // Use a point near the centroid of our saved triangle. Screen coordinates are
  // not reused after the map recenters; derive from Leaflet using saved polygon.
  const pin=await evalJs(`(() => {const p=window.SW07_GET_STATE().fields[0].boundary_geojson; const pts=JSON.parse(p).coordinates[0].slice(0,-1);const lat=pts.reduce((a,x)=>a+x[1],0)/pts.length;const lng=pts.reduce((a,x)=>a+x[0],0)/pts.length;const map=[...document.querySelectorAll('.leaflet-container')].map(el=>el._leaflet_id && Object.values(window).find(v=>v && v._container===el && typeof v.latLngToContainerPoint==='function')).find(Boolean);return {lat,lng,hasMap:!!map};})()`);
  // Leaflet's event method receives actual geographic coordinates; dispatch
  // a real DOM click at map center, which is inside this centroid-centered field.
  const x=Math.round(r2.x+r2.w*.49), y=Math.round(r2.y+r2.h*.52);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  // The evaluated expressions are template strings. Avoid backslash-escaped
  // regexes here: JS template literals consume \s and \( before CDP sees them.
  // This exact button label is confirmed by the real Field Map UI.
  await waitFor(
    `[...document.querySelectorAll('button')].some(b =>
      (b.textContent || '').trim().includes('Launch Mission (1 Pins)') && !b.disabled
    )`,
    'Waypoint not accepted in saved boundary'
  );
  await screenshot('04_mission_pin.png');
  const launched=await evalJs(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>
      (x.textContent || '').trim().includes('Launch Mission (1 Pins)') && !x.disabled
    );
    if(!b) return false;
    b.click();
    return true;
  })()`);
  assert.ok(launched,'Mission launch button missing');
  await waitFor(`window.SW07_GET_STATE().missions.length===1`, 'Mock mission INSERT missing');
  await waitFor(`document.body.innerText.includes('Mission "SW07 Test Mission" launched!')`, 'Mission launch confirmation missing');
  const state2=await evalJs(`window.SW07_GET_STATE()`);
  assert.equal(state2.missions[0].field_id,state2.fields[0].id);
  await screenshot('05_mission_launched.png');
  console.log('PASS: Mission created through UI and linked to saved field');
  // Inject simulated telemetry only: this does NOT accelerate the five-minute
  // observation or fabricate a finalized sample.
  await evalJs(`window.SW07_EMIT('sensor-data',{type:'sensor',seq:7001,soilValid:1,satsLocked:8,lat:14.6095,lng:120.9895,moisture:36.5,ph:6.8,ec:420,nitrogen:20,phosphorus:15,potassium:40})`);
  await waitFor(`window.SW07_GET_STATE().rawReadings.length>=1`, 'Raw sensor data was not saved through UI listener');
  const final=await evalJs(`window.SW07_GET_STATE()`);
  assert.equal(final.rawReadings[0].mission_id,final.missions[0].id);
  assert.equal(final.rawReadings[0].moisture,36.5);
  assert.ok(final.rawReadings[0].latitude!==null,'Verified GPS should be retained');
  assert.equal(final.telemetry.length,0,'No five-minute averaged sample should exist yet');
  const unsafe2=await evalJs(`window.SW07_CALLS.filter(c=>/send_movement|send_mission|serial_write|confirm_mission_deployment|prepare_mission_deployment|set_rx_board_mode/.test(c))`);
  assert.deepEqual(unsafe2,[]);
  await screenshot('06_live_raw_telemetry.png');
  await writeFile(path.join(dir,'sw07_step2_evidence.json'),JSON.stringify({field:final.fields[0],mission:final.missions[0],raw:final.rawReadings,finalizedCount:final.telemetry.length,unsafeCalls:unsafe2},null,2));
  console.log('PASS: Synthetic sensor-data event persisted in raw-reading mock');
  console.log('PASS: Raw reading linked to correct mission and field');
  console.log('PASS: Five-minute finalization not fabricated');
  console.log('PASS: No unsafe radio or movement calls');
  console.log('SW07 Step 2 checks: 5/5 PASS');
  console.log('Evidence screenshots:',dir);

} catch(error) {
  console.error('SW07 Steps 1-2 failed:',error.message);
  try { console.error('Diagnostic:',JSON.stringify(await evalJs(`({body:document.body?.innerText?.slice(0,1600),fields:window.SW07_GET_STATE?.().fields,queries:window.SW07_QUERIES?.slice(-12),writes:window.SW07_WRITES?.slice(-8)})`))); }catch{}
  process.exitCode=1;
} finally {socket.close();}
