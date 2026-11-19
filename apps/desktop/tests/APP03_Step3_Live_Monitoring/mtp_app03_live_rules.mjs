// MTP-APP-03 Step 3 — Live Monitoring rice, cacao and coffee source-rule regression.
// Node 24+, zero dependencies, read-only. Executes the real App.jsx useMemo callback
// in a restricted VM with test records. No Vite, browser, SQLite or hardware required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const appPath = path.join(root, 'apps', 'desktop', 'src', 'App.jsx');
const evidencePath = path.join(root, 'apps', 'desktop', 'tests', 'mtp_app03_step3_evidence.json');
const checks=[]; const failures=[]; const cautions=[];
let comparisons=0;
const source=fs.readFileSync(appPath,'utf8');
const pattern=/const cropSuitability\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?\n\s*\},\s*\[\s*assessedHistoricalRecords\s*,\s*liveData\s*\]\s*\);/;
const block=source.match(pattern)?.[0];
if (!block) {
  console.error('FAIL: Cannot locate complete cropSuitability useMemo callback. Source changed; no assertions run.');
  process.exitCode=1;
} else {
  const constantMatch=source.match(/(?:const|let)\s+HISTORICAL_ASSESSMENT_MIN\s*=\s*(\d+)\b/);
  const HISTORICAL_ASSESSMENT_MIN=constantMatch ? Number(constantMatch[1]) : 10;
  if (!constantMatch) cautions.push('HISTORICAL_ASSESSMENT_MIN not declared as simple numeric constant in App.jsx; test assumed 10 from project guide. Verify this constant in its imported source.');
  const evalActual=(liveData=null, assessedHistoricalRecords=[])=>{
    const context={liveData,assessedHistoricalRecords,HISTORICAL_ASSESSMENT_MIN,useMemo:fn=>fn()};
    const result=vm.runInNewContext(`(() => { ${block}; return cropSuitability; })()`,context,{timeout:1500,filename:'App.jsx cropSuitability isolated evaluation'});
    return result ? JSON.parse(JSON.stringify(result)) : result;
  };
  const validNumber=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const average=(rows,key)=>{const vals=rows.map(x=>x[key]).filter(validNumber).map(Number);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null};
  // Independent expected-value oracle based on documented Live Monitoring requirements;
  // kept separate from the extracted App.jsx implementation.
  const oracle=(live,history)=>{
    const usingHistory=history.length>=HISTORICAL_ASSESSMENT_MIN;
    const rows=usingHistory?history:(live?.soilValid===1?[live]:[]);
    if (!rows.length) return null;
    const ph=average(rows,'ph'), moisture=average(rows,'moisture');
    const names=[];
    if (ph!=null&&moisture!=null&&5.5<=ph&&ph<=6.8&&moisture>=35) names.push('Rice');
    if (ph!=null&&moisture!=null&&5<=ph&&ph<=7.5&&moisture>=40) names.push('Cacao');
    if (ph!=null&&moisture!=null&&5<=ph&&ph<=6.5&&moisture>=30) names.push('Coffee');
    const fmt=v=>v==null?'--':v.toFixed(1);
    return {recommendedCrops:names,sourceLabel:usingHistory?`average of ${rows.length} selected historical records`:'current live reading',ph:fmt(ph),nitrogen:fmt(average(rows,'nitrogen')),phosphorus:fmt(average(rows,'phosphorus')),potassium:fmt(average(rows,'potassium'))};
  };
  const compare=(label,live,history=[])=>{
    const expected=oracle(live,history);
    const actual=evalActual(live,history);
    comparisons++;
    try {assert.deepEqual(actual,expected,`Mismatch: ${label}`);}
    catch(err){failures.push({label,expected,actual,error:err.message}); if(failures.length<=5) console.error('FAIL:',label,err.message);}
  };
  // Cross-product tests include all relevant crop pH and moisture boundaries.
  const phValues=[-1,0,4.99,5,5.49,5.5,6.5,6.8,6.81,7.5,7.51,14,15];
  const moistureValues=[-1,0,29.99,30,34.99,35,39.99,40,80];
  for (const ph of phValues) for (const moisture of moistureValues)
    compare(`pH ${ph}, moisture ${moisture}`,{soilValid:1,ph,moisture,nitrogen:10,phosphorus:20,potassium:30});
  checks.push({name:'Live pH/moisture cross-product boundaries',count:phValues.length*moistureValues.length});
  for (const [name,live] of [
    ['no packet',null],['invalid probe',{soilValid:0,ph:6,moisture:50}],
    ['missing pH',{soilValid:1,moisture:45}],['missing moisture',{soilValid:1,ph:6}],
    ['blank pH',{soilValid:1,ph:'',moisture:50}],['null pH',{soilValid:1,ph:null,moisture:50}],
    ['not-a-number pH',{soilValid:1,ph:'bad',moisture:50}],
    ['blank nutrients',{soilValid:1,ph:6,moisture:45,nitrogen:'',phosphorus:null,potassium:undefined}],
    ['numeric strings',{soilValid:1,ph:'6.0',moisture:'40',nitrogen:'12',phosphorus:13,potassium:14}],
    ['invalid soilValid string',{soilValid:'1',ph:6,moisture:50}],
  ]) compare(name,live);
  checks.push({name:'Missing, invalid, formatting and packet-validity cases',count:10});
  const histRow=(ph,moisture,other={})=>({ph,moisture,nitrogen:12,phosphorus:19,potassium:26,...other});
  const historics=[
    ['below history minimum uses live', {soilValid:1,ph:6,moisture:40},Array.from({length:Math.max(0,HISTORICAL_ASSESSMENT_MIN-1)},()=>histRow(7.4,10))],
    ['minimum history overrides live',{soilValid:1,ph:4,moisture:10},Array.from({length:HISTORICAL_ASSESSMENT_MIN},()=>histRow(6,40))],
    ['history with no valid pH',{soilValid:1,ph:6,moisture:50},Array.from({length:HISTORICAL_ASSESSMENT_MIN},()=>histRow(null,40))],
    ['history average near Rice boundary',null,Array.from({length:HISTORICAL_ASSESSMENT_MIN},(_,i)=>histRow(i%2?6.6:5.4,i%2?40:30))],
    ['mixed missing values average valid subset',null,Array.from({length:HISTORICAL_ASSESSMENT_MIN},(_,i)=>histRow(i%2?'':6.4,i%2?null:43,{nitrogen:i%2?null:12}))],
    ['historical NPK formatting',null,Array.from({length:HISTORICAL_ASSESSMENT_MIN},(_,i)=>histRow(6,40,{nitrogen:10+i,phosphorus:20+i,potassium:30+i}))]
  ];
  for (const [name,live,history] of historics) compare(name,live,history);
  checks.push({name:'Historical-record selection, averages and missing data',count:historics.length});
  // This is a documented coverage gap, not an automated agronomic judgement.
  const liveSection=source.slice(source.indexOf('const cropSuitability = useMemo'),source.indexOf('const cropSuitability = useMemo')+4000);
  const riceUsesWaterContext=/\b(irrigation|drainage|water availability|cultivation method|rainfed)\b/i.test(liveSection);
  if (!riceUsesWaterContext) cautions.push('Live Monitoring Rice recommendation only checks pH/moisture in this logic; irrigation, drainage and cultivation conditions are not evaluated. Confirm an appropriate UI disclosure before marking MTP Step 4 fully PASS.');
  const agreement=comparisons?100*(comparisons-failures.length)/comparisons:0;
  const results={test:'MTP-APP-03 Step 3 — Live Monitoring crop rules',mode:'Actual App.jsx useMemo evaluated in isolated Node VM; not browser UI',timestamp:new Date().toISOString(),source:'apps/desktop/src/App.jsx',historicalMinimum:HISTORICAL_ASSESSMENT_MIN,comparisons,passed:comparisons-failures.length,failed:failures.length,agreement,checks,cautions,failures,productionDatabaseOpened:false,hardwareCalls:0};
  fs.mkdirSync(path.dirname(evidencePath),{recursive:true});fs.writeFileSync(evidencePath,JSON.stringify(results,null,2));
  console.log(`Rule agreement: ${results.passed}/${comparisons} (${agreement.toFixed(1)}%)`);
  for (const c of checks) console.log(`${failures.length?'CHECK':'PASS'}: ${c.name} (${c.count} vectors)`);
  for (const c of cautions) console.log('REVIEW REQUIRED:',c);
  console.log(`Evidence: ${evidencePath}`);
  console.log('No database opened; no hardware calls.');
  if (failures.length) process.exitCode=1;
}
