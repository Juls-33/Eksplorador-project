#!/usr/bin/env node
'use strict';
// Eksplorador TF300, pure Node.js. Deliberately updates BOTH Mega and desktop
// validators: updating the UI alone produces commands the Mega would reject.
const fs = require('node:fs');
const path = require('node:path');
const MAX_S = 300;
const PATCHES = [
  ['apps/desktop/src/utils/pointToPointMission.js', patchPlanner],
  ['apps/desktop/src/components/PointToPointMissionDialog.jsx', patchDialog],
  ['apps/desktop/src/components/MissionDeploymentWizard.jsx', patchWizard],
  ['apps/desktop/src-tauri/src/mission_protocol.rs', patchRust],
];
function die(s) { throw new Error(s); }
function one(s, re, substitute, label) {
  const all = [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags+'g'))];
  if (all.length !== 1) die(`${label}: expected one match; found ${all.length}. No files changed.`);
  return s.replace(re, substitute);
}
function patchPlanner(s) {
  s = one(s, /MAX_LEG_S\s*=\s*60\.000/, 'MAX_LEG_S = 300.000', 'Planner limit');
  s = s.replace('max 60 seconds', 'max 300 seconds (5 minutes)');
  s = s.replace('0.100–60.000 s range', '0.100–300.000 s range');
  // Real GPS distances produce binary floating-point noise at exact 300 s.
  // Allow epsilon only for numerical rounding, not extra travel duration.
  s = one(s, /estimatedTotalS > MAX_LEG_S\)/, 'estimatedTotalS > MAX_LEG_S + 1e-9)', '300-second floating-point boundary');
  if (s.includes('0.100–60.000 s') || /MAX_LEG_S\s*=\s*60\.000/.test(s)) die('Planner still contains 60-second limit');
  return s;
}
function patchDialog(s) {
  // All current mission-dialog variants use MAX_LEG_S for the display.
  if (!s.includes('MAX_LEG_S') || !s.includes('makeStraightLeg'))
    die('Dialog is not the expected bounded timed mission editor');
  // Add extra operator warning only for extended legs; does NOT bypass authorizations.
  const anchor = '          {plan ? <>\n            <p style={{ margin: \'8px 0\' }}>Forward command:';
  if (!s.includes(anchor)) die('Dialog missing review-section anchor');
  return s.replace(anchor,
    "          {plan ? <>\n" +
    "            {plan.durationS > 60 && <p role=\"alert\" style={{ color: '#92400e', fontSize: '0.82rem' }}>Extended timed movement (over 60 seconds). This is open-loop distance estimation, not GPS waypoint tracking. The present bench ultrasonic profile must not be used for autonomous ground travel; verify strict obstacle protection and supervise the route before any field operation.</p>}\n" +
    "            <p style={{ margin: '8px 0' }}>Forward command:");
}
function patchWizard(s) {
  if (!s.includes('MissionDeploymentWizard') || !s.includes('MAX_LEG_S'))
    die('Unexpected MissionDeploymentWizard.jsx version');
  s = one(s, /up to 60 seconds\)/, 'up to 300 seconds (5 minutes))', 'Deployment guide text');
  return s;
}
function patchRust(s) {
  s = one(s, /MAX_TIMED_LEG_SECONDS:\s*f64\s*=\s*60\.000;/,
    'MAX_TIMED_LEG_SECONDS: f64 = 300.000;', 'Rust limit');
  s = s.replace('A31_MAX_STEP_MS = 60000', 'A31_MAX_STEP_MS = 300000');
  s = s.replace('TF0.100–TF60.000', 'TF0.100–TF300.000');
  s = one(s, /"TF45\.000", "TF60\.000"/, '"TF45.000", "TF60.000", "TF180.000", "TF299.999", "TF300.000"', 'Rust acceptance tests');
  s = one(s, /"TF0\.099", "TF60\.001", "TF61\.000"/,
    '"TF0.099", "TF300.001", "TF301.000"', 'Rust rejection tests');
  if (s.includes('MAX_TIMED_LEG_SECONDS: f64 = 60.000;')) die('Rust still uses 60-second limit');
  return s;
}
function patchMega(s) {
  // Fail rather than touching an old or different Mega sketch. The working
  // bench firmware has encoder signs fixed and the sonar transient guard.
  if (!s.includes('sonarBenchCheckPending') ||
      !/ENC_LEFT_FORWARD_SIGN\s*=\s*-1/.test(s) ||
      !/ENC_RIGHT_FORWARD_SIGN\s*=\s*\+1/.test(s) ||
      !s.includes('A31_PAUSE_HOLD_CONFIRM_MS')) {
    die('Mega version mismatch: cannot confirm encoder-sign, sonar transient guard and pause implementation. Use the currently flashed source.');
  }
  s = one(s, /(A31_MAX_STEP_MS\s*=\s*)60000\b/, '$1300000', 'Mega per-step limit');
  s = one(s, /(A31_MAX_LEG_MS\s*=\s*)120000\b/, '$1300000', 'Mega per-leg limit');
  // Unchanged: sonar thresholds, bench vs strict configuration, motor signs,
  // HOLD/DISARM pause, encoder stall/overcurrent interlocks, timing logic.
  return s;
}
function scan(dir, depth=0) {
  if (depth > 9 || !fs.existsSync(dir)) return [];
  const out=[];
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    if (item.isDirectory()) {
      if (['node_modules','.git','target','dist','build','backups'].includes(item.name)) continue;
      out.push(...scan(path.join(dir,item.name),depth+1));
    } else if (item.name.endsWith('.ino')) {
      const p=path.join(dir,item.name);
      const s=fs.readFileSync(p,'utf8');
      if (/A31_MAX_STEP_MS\s*=\s*60000\b/.test(s) &&
          /A31_MAX_LEG_MS\s*=\s*120000\b/.test(s) &&
          s.includes('sonarBenchCheckPending')) out.push(p);
    }
  }
  return out;
}
function parseArgs(argv) {
  const options={root:'.',mega:null,dryRun:false};
  const args=[...argv];
  while(args.length) {
    const a=args.shift();
    if(a==='--dry-run') options.dryRun=true;
    else if(a==='--mega') { if(!args.length) die('--mega needs a path'); options.mega=args.shift(); }
    else if(a.startsWith('--')) die('Unknown option: '+a);
    else options.root=a;
  }
  return options;
}
function apply(root, options={}) {
  const dryRun=!!options.dryRun;
  root=path.resolve(root);
  if(!fs.existsSync(root)) die('Project directory not found: '+root);
  let mega;
  if(options.mega) {
    mega=path.resolve(root,options.mega);
  } else {
    const candidates=scan(path.join(root,'embedded'));
    if(candidates.length!==1) die('Expected one matching *current* Mega sketch; found '+candidates.length+':\n  '+candidates.map(p=>path.relative(root,p)).join('\n  ')+'\nUse --mega "embedded\\path\\semi-autonomous.ino" to select the actually flashed Mega source.');
    mega=candidates[0];
  }
  if(!mega.startsWith(root+path.sep) || !mega.endsWith('.ino') || !fs.existsSync(mega))
    die('Mega file must be an existing .ino inside this project');
  const plan=[...PATCHES, [path.relative(root,mega),patchMega]].map(([rel,change])=>{
    const p=path.resolve(root,rel);
    if(!p.startsWith(root+path.sep) || !fs.existsSync(p)) die('Missing file: '+rel);
    const original=fs.readFileSync(p,'utf8');
    const crlf=original.includes('\r\n');
    const normalized=original.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
    const ready = rel.endsWith('.ino')
      ? /A31_MAX_STEP_MS\s*=\s*300000\b/.test(normalized) && /A31_MAX_LEG_MS\s*=\s*300000\b/.test(normalized)
      : rel.endsWith('pointToPointMission.js')
        ? /MAX_LEG_S\s*=\s*300\.000/.test(normalized)
        : rel.endsWith('mission_protocol.rs')
          ? /MAX_TIMED_LEG_SECONDS:\s*f64\s*=\s*300\.000/.test(normalized)
          : rel.endsWith('PointToPointMissionDialog.jsx')
            ? normalized.includes('Extended timed movement (over 60 seconds)')
            : normalized.includes('up to 300 seconds (5 minutes)');
    const updated=ready?normalized:change(normalized);
    return {rel,p,original,updated:crlf?updated.replace(/\n/g,'\r\n'):updated,ready};
  });
  for(const p of plan) console.log(`${p.ready?'ALREADY PATCHED':dryRun?'WOULD PATCH':'PATCH'}: ${p.rel}`);
  if(dryRun || plan.every(p=>p.ready)) {
    console.log(dryRun?'Dry run complete; no files changed.':'Already updated; no files changed.');
    return plan;
  }
  const backup=path.join(__dirname,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backup,{recursive:true});
  const changed=[];
  for(const p of plan.filter(p=>!p.ready)) {
    const dest=path.join(backup,p.rel);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,p.original);
  }
  try {
    for(const p of plan.filter(p=>!p.ready)) {
      const tmp=p.p+'.tf300-tmp';
      try { fs.writeFileSync(tmp,p.updated); fs.renameSync(tmp,p.p); }
      catch(e) {try{fs.unlinkSync(tmp)}catch{} throw e;}
      changed.push(p);
    }
  } catch(e) {
    for(const p of changed.reverse()) fs.writeFileSync(p.p,p.original);
    die('Patch failed; changed files restored. Backup at '+backup+'; '+e.message);
  }
  console.log('Done. Backups: '+backup);
  console.log('IMPORTANT: Mega .ino source is updated but the board firmware is NOT flashed. Verify/flash separately.');
  console.log('Rover ESP32, RX_BOARD, LoRa setup, obstacle popup, soil, GPS and database files were NOT modified.');
  return plan;
}
if(require.main===module) {
  try {const a=parseArgs(process.argv.slice(2));apply(a.root,{dryRun:a.dryRun,mega:a.mega});}
  catch(e){console.error('ERROR:',e.message);process.exitCode=1;}
}
module.exports={apply,patchPlanner,patchDialog,patchWizard,patchRust,patchMega,scan,parseArgs};
