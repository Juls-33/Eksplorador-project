// MTP-APP-03 browser CRUD / form validation against REAL React UI and an isolated Tauri IPC mock.
// No production database, LoRa, motor controls, or native Tauri backend are accessed.
// Requires Node >=22, Vite at 127.0.0.1:1420 and ISOLATED Chrome CDP port 9226.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.APP03_URL || 'http://127.0.0.1:1420/';
const DEBUG = process.env.APP03_DEBUG_URL || 'http://127.0.0.1:9226';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'eksplorador-app03-browser-crud-'));
let socket;
let sequence=0;
let requests=new Map();
const checks=[];
function pass(s){checks.push(s);console.log('PASS:',s);}
try {
  const response = await fetch(DEBUG + '/json');
  const pages = await response.json();
  const page = pages.find(p=>p.type==='page');
  assert.ok(page,'No Chrome page at CDP port 9226. Start isolated Chrome.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  sequence=0;
  requests=new Map();
  socket.addEventListener('message', event=>{
    const msg=JSON.parse(event.data);
    if(!msg.id||!requests.has(msg.id))return;
    const {resolve,reject}=requests.get(msg.id);requests.delete(msg.id);
    if(msg.error)reject(new Error(msg.error.message));else resolve(msg.result);
  });
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;requests.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async(expression)=>{
    const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error('Browser JS exception: '+JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const wait=async(predicate, label, rounds=90)=>{
    for(let i=0;i<rounds;i++){
      if(await evaluate(predicate))return;
      await delay(200);
    }
    throw new Error(label+'; UI diagnostic: '+JSON.stringify(await evaluate(`({text:document.body?.innerText?.slice(-1800),buttons:[...document.querySelectorAll('button')].map(b=>({label:b.textContent.trim(),title:b.title})).slice(-35),queries:window.APP03_QUERIES?.slice(-8),writes:window.APP03_WRITES?.slice(-8),errors:window.APP03_ERRORS?.slice(-8)})`)));
  };
  const screenshot=async(name)=>{
    const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(evidenceDir,name),Buffer.from(img.data,'base64'));
  };
  const click=async(predicate,label)=>{
    const ok=await evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>(${predicate}) && !b.disabled);if(!b)return false;b.click();return true;})()`);
    assert.ok(ok,'Button not found: '+label);
    await delay(200);
  };
  const setNative=async(selector,value,index=0)=>{
    const ok=await evaluate(`(() => {const els=[...document.querySelectorAll(${JSON.stringify(selector)})];const el=els[${index}];if(!el)return false; const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    assert.ok(ok,`Input missing: ${selector}[${index}]`);
    await delay(80);
  };
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source: `
  (() => {
    const cropColumns=['id','name','category','min_ph','max_ph','min_moisture','max_moisture','min_ec','max_ec','min_n','max_n','min_p','max_p','min_k','max_k','notes','compatible_soil_types'];
    const crops=[{id:'CRP-001',name:'Rice (Oryza sativa)',category:'Cereal / Grain',min_ph:5.5,max_ph:7,min_moisture:40,max_moisture:80,min_ec:.5,max_ec:2,min_n:20,max_n:40,min_p:30,max_p:50,min_k:40,max_k:70,notes:'Reference fixture',compatible_soil_types:'[]'}];
    const fields=[{id:1,name:'APP03 Sample Field',boundary_geojson:null,soil_type:'loam',mission_count:1}];
    const missions=[{id:10,field_id:1,field_name:'APP03 Sample Field',name:'APP03 Sample Mission',mission_date:'2026-11-18',status:'completed',pins_geojson:null}];
    const telemetry=[{id:1,mission_id:10,timestamp:'2026-11-18T08:00:00Z',latitude:14.6095,longitude:120.9895,ph:6.8,moisture:42,ec:420,nitrogen:20,phosphorus:15,potassium:40,sample_session_id:'APP03-SAMPLE-1'}];
    window.APP03_MOCK_ACTIVE=true;
    window.APP03_QUERIES=[];window.APP03_WRITES=[];window.APP03_CALLS=[];window.APP03_ERRORS=[];
    window.APP03_GET_STATE=()=>({crops:crops.map(c=>({...c})),fields,missions,telemetry});
    window.addEventListener('error',e=>window.APP03_ERRORS.push(String(e.message)));
    window.addEventListener('unhandledrejection',e=>window.APP03_ERRORS.push(String(e.reason)));
    const callbacks=new Map(),listeners=new Map();let nextCb=0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
    window.__TAURI_INTERNALS__={
      transformCallback(fn){callbacks.set(++nextCb,fn);return nextCb;},convertFileSrc(v){return v;},
      async invoke(command,args={}){
        window.APP03_CALLS.push(command);
        if(/send_movement|send_mission|serial_write|confirm_mission_deployment|prepare_mission_deployment|set_rx_board_mode/.test(command))throw Error('APP03 SAFETY: Hardware IPC blocked '+command);
        if(command==='plugin:event|listen'){listeners.set(args.event,[...(listeners.get(args.event)||[]),args.handler]);return args.handler;}
        if(command==='plugin:event|unlisten')return;
        if(command==='get_recent_telemetry')return {records:[],generation:1};
        if(command==='get_rx_board_connection')return {connected:false,mode:'RX',revision:1};
        if(command==='database_status')return {total:telemetry.length};
        if(command==='init_db')return;
        const sql=String(args.sql??args.query??'');
        const normalized=sql.replace(/\\s+/g,' ').trim().toLowerCase();
        const values=args.values||[];
        if(command==='database_select'){
          let result=[],kind='unmatched';
          const schemaTables=['fields','crop_profiles','missions','telemetry'];
          const table=schemaTables.find(t=>normalized.startsWith('pragma table_info('+t+')')||normalized.startsWith('pragma table_info("'+t+'")'));
          if(table){
            const columns={fields:['id','name','boundary_geojson','soil_type','created_at','updated_at'],missions:['id','field_id','name','mission_date','status','pins_geojson'],telemetry:['id','mission_id','ph','moisture','ec','latitude','longitude','nitrogen','phosphorus','potassium','sample_session_id','location_source'],crop_profiles:cropColumns};
            result=columns[table].map((name,cid)=>({cid,name,type:'TEXT',notnull:0,dflt_value:null,pk:name==='id'?1:0}));kind='schema_'+table;
          }
          else if(normalized.includes('from crop_profiles')){result=crops.map(c=>({...c}));kind='crop_profiles';}
          else if(normalized.includes('from fields f')){result=fields;kind='fields';}
          else if(normalized.includes('from fields')){result=fields;kind='fields';}
          else if(normalized.includes('from missions m')){result=missions;kind='missions';}
          else if(normalized.includes('from missions')){result=missions;kind='missions';}
          else if(normalized.includes('from telemetry')){result=telemetry;kind='telemetry';}
          window.APP03_QUERIES.push({kind,sql:sql.slice(0,250),count:result.length});
          return result;
        }
        if(command==='database_execute'){
          const v=values;
          window.APP03_WRITES.push({sql:sql.slice(0,280),values:v});
          if(normalized.startsWith('insert into crop_profiles')){
            const cols=['id','name','category','min_ph','max_ph','min_moisture','max_moisture','min_ec','max_ec','min_n','max_n','min_p','max_p','min_k','max_k','notes','compatible_soil_types'];
            const row=Object.fromEntries(cols.map((name,i)=>[name,v[i]]));
            const i=crops.findIndex(c=>c.id===row.id);
            if(i===-1)crops.push(row);else crops[i]={...crops[i],...row};
            return {rowsAffected:1,lastInsertId:null};
          }
          if(normalized.startsWith('delete from crop_profiles')){
            const i=crops.findIndex(c=>String(c.id)===String(v[0]));
            if(i<0)return {rowsAffected:0,lastInsertId:null};
            crops.splice(i,1);return {rowsAffected:1,lastInsertId:null};
          }
          if(normalized.startsWith('update crop_profiles') && normalized.includes('compatible_soil_types')){
            const c=crops.find(c=>String(c.id)===String(v[1]));if(c&&(!c.compatible_soil_types||c.compatible_soil_types==='[]'))c.compatible_soil_types=v[0];
            return {rowsAffected:c?1:0,lastInsertId:null};
          }
          return {rowsAffected:0,lastInsertId:null};
        }
        return null;
      }
    };
  })();
  `});
  await cdp('Page.navigate',{url:BASE});
  await wait(`!!window.APP03_MOCK_ACTIVE && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Crop Assessment'))`,'Crop Assessment nav missing');
  await click(`b.textContent.trim()==='Crop Assessment'`,'Crop Assessment');
  await wait(`document.body.innerText.includes('Preliminary Crop Compatibility') && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Add Crop Profile'))`,'Crop Assessment UI not ready');
  await screenshot('01_crop_assessment_initial.png');
  pass('Actual Crop Assessment page opened with isolated Tauri database mock');
  const baseline=await evaluate(`window.APP03_GET_STATE().crops.map(c=>c.id)`);
  await click(`b.textContent.includes('Add Crop Profile')`,'Add Crop Profile');
  await wait(`document.body.innerText.includes('Add New Crop Threshold Profile')`,'Create profile dialog absent');
  // Demonstrate validation error before writing any profile.
  await click(`b.textContent.trim()==='Save Profile'`,'Save Profile with blank name');
  await wait(`document.body.innerText.includes('Crop name cannot be empty.')`,'Blank crop-name validation missing');
  assert.deepEqual(await evaluate(`window.APP03_GET_STATE().crops.map(c=>c.id)`),baseline);
  await screenshot('02_empty_name_rejected.png');
  pass('Blank crop name rejected without database write');
  await setNative(`.ui-dialog input[placeholder="e.g. Sugarcane (Saccharum officinarum)"]`,'APP03 Synthetic Crop');
  // Test invalid pH range. In current UI the two numeric inputs are min and max pH.
  const inputCount=await evaluate(`document.querySelectorAll('.ui-dialog input[type=number]').length`);
  assert.ok(inputCount>=2,'Expected pH min/max numeric inputs');
  await setNative('.ui-dialog input[type=number]','7.0',0);
  await setNative('.ui-dialog input[type=number]','6.0',1);
  await click(`b.textContent.trim()==='Save Profile'`,'Save Profile with reversed range');
  await wait(`document.body.innerText.includes('must be lower than')`,'Invalid pH range not rejected');
  await screenshot('03_invalid_range_rejected.png');
  pass('Invalid pH minimum/maximum rejected');
  await setNative('.ui-dialog input[type=number]','5.5',0);
  await setNative('.ui-dialog input[type=number]','6.5',1);
  await click(`b.textContent.trim()==='Save Profile'`,'Save valid synthetic profile');
  await wait(`window.APP03_GET_STATE().crops.some(c=>c.name==='APP03 Synthetic Crop')`,'Create did not persist to mock');
  await wait(`!document.body.innerText.includes('Add New Crop Threshold Profile')`,'Create form did not close');
  const created=await evaluate(`window.APP03_GET_STATE().crops.find(c=>c.name==='APP03 Synthetic Crop')`);
  assert.equal(Number(created.min_ph),5.5);assert.equal(Number(created.max_ph),6.5);
  assert.ok((await evaluate(`document.body.innerText`)).includes('APP03 Synthetic Crop'),'Created profile not shown in UI');
  await screenshot('04_profile_created.png');
  pass('CREATE/READ: real form saved profile and UI displayed it');
  // Current UI uses title="Edit Crop Thresholds" for the selected profile.
  await click(`b.title==='Edit Crop Thresholds'`,'Edit Crop Thresholds');
  await wait(`document.body.innerText.includes('Edit Crop Profile')`,'Edit dialog absent');
  await setNative('.ui-dialog input[type=number]','7.0',1);
  await click(`b.textContent.trim()==='Save Profile'`,'Save edited profile');
  await wait(`window.APP03_GET_STATE().crops.some(c=>c.name==='APP03 Synthetic Crop' && Number(c.max_ph)===7)`,'UPsert did not update pH');
  const changed=await evaluate(`window.APP03_GET_STATE().crops.find(c=>c.name==='APP03 Synthetic Crop')`);
  assert.equal(changed.id,created.id,'Editing should retain original profile ID');
  assert.equal(Number(changed.max_ph),7);
  await screenshot('05_profile_updated.png');
  pass('UPDATE: editing real modal retained ID and changed maximum pH to 7.0');
  // Reload page while preserving the mock state in this page's JS realm? A CDP
  // navigation reinstalls the mock from scratch; that is NOT a persistence test.
  // SQLite close/reopen was already verified separately in Step 1.
  await click(`b.title==='Delete Crop Profile'`,'Delete selected synthetic crop profile');
  await wait(`!window.APP03_GET_STATE().crops.some(c=>c.id===${JSON.stringify(created.id)})`,'Delete did not remove profile');
  const result=await evaluate(`window.APP03_GET_STATE()`);
  assert.deepEqual(result.crops.map(c=>c.id),baseline,'Delete changed unrelated fixtures');
  assert.ok(!(await evaluate(`document.body.innerText`)).includes('APP03 Synthetic Crop'),'Deleted crop still appears in UI');
  await screenshot('06_profile_deleted.png');
  pass('DELETE: real UI removed only synthetic profile');
  const hardware=await evaluate(`window.APP03_CALLS.filter(c=>/send_movement|send_mission|serial_write|confirm_mission_deployment|prepare_mission_deployment|set_rx_board_mode/.test(c))`);
  assert.deepEqual(hardware,[]);
  pass('No hardware/movement/radio IPC calls');
  await writeFile(path.join(evidenceDir,'mtp_app03_browser_evidence.json'),JSON.stringify({test:'MTP-APP-03 Step 2 — Browser CRUD with mocked Tauri SQLite',checks,createdId:created.id,initialPH:[5.5,6.5],updatedPH:[5.5,7],finalProfiles:result.crops,dbWrites:await evaluate(`window.APP03_WRITES`),dbQueries:await evaluate(`window.APP03_QUERIES`),hardwareCalls:hardware,limitations:'Real UI handlers; in-memory mock database. SQLite persistence was tested separately in APP-03 Step 1. Live Monitoring recommendation rules not yet tested.'},null,2));
  console.log(`APP03 Browser CRUD checks: ${checks.length}/${checks.length} PASS`);
  console.log('Screenshots and evidence:',evidenceDir);
} catch(error) {
  console.error('APP03 Browser CRUD FAILED:',error.message);
  process.exitCode=1;
  try {
    // Capture debugging evidence even when an assertion fails.
    const request=++sequence;
    const p=new Promise((resolve,reject)=>{requests.set(request,{resolve,reject});socket.send(JSON.stringify({id:request,method:'Runtime.evaluate',params:{expression:`({body:document.body?.innerText?.slice(0,2400),buttons:[...document.querySelectorAll('button')].map(b=>({label:b.textContent.trim(),title:b.title})).slice(-50),crops:window.APP03_GET_STATE?.().crops,writes:window.APP03_WRITES?.slice(-8),queries:window.APP03_QUERIES?.slice(-8),errors:window.APP03_ERRORS?.slice(-10)})`,returnByValue:true}}));});
    const r=await p;await writeFile(path.join(evidenceDir,'failure_diagnostic.json'),JSON.stringify(r.result.value,null,2));
    const capture=++sequence;
    const q=new Promise((resolve,reject)=>{requests.set(capture,{resolve,reject});socket.send(JSON.stringify({id:capture,method:'Page.captureScreenshot',params:{format:'png'}}));});
    const image=await q;await writeFile(path.join(evidenceDir,'failure_screen.png'),Buffer.from(image.data,'base64'));
  }catch(e){console.error('Unable to save full diagnostics:',e.message);}
  console.log('Diagnostic folder:',evidenceDir);
} finally {socket?.close();}
