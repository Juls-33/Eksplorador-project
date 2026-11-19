#!/usr/bin/env node
'use strict';
// EKSPLORADOR GPS_MISSION_FIX_V1 — Node.js only, no npm dependencies.
// Changes only 3 frontend files. Does not touch firmware, Rust, DB, or motor logic.
// Usage: node apply_gps_mission_fix.js <project-root> [--dry-run]
const fs = require('node:fs');
const path = require('node:path');
const MARKER = 'EKSPLORADOR_GPS_MISSION_FIX_V1';
function fail(msg) { throw new Error(msg); }
function replaceOne(text, needle, replacement, label) {
  const count = text.split(needle).length - 1;
  if (count !== 1) fail(`${label}: expected one anchor, found ${count}. No project files changed.`);
  return text.replace(needle, replacement);
}
function replaceOneRegex(text, re, replacement, label) {
  const matches = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags+'g'))];
  if (matches.length !== 1) fail(`${label}: expected one anchor, found ${matches.length}. No project files changed.`);
  return text.replace(re, replacement);
}
function updateHelper(text) {
  text = replaceOne(text, "import { calculateBearing, calculateDistance } from './geo.js';", "import { calculateBearing, calculateDistance } from './geo.js';\n\n// " + MARKER, 'GPS helper import');
  const oldFunc = `export function freshFusionStart(fix, now = Date.now()) {
  if (!fix || fix.source !== 'fusion' || fix.valid !== true || !validPoint(fix.position) ||
      !Number.isFinite(fix.receivedAt) || !Number.isFinite(fix.ageAtReceiptMs) ||
      fix.receivedAt > now || fix.ageAtReceiptMs < 0 ||
      now - fix.receivedAt + fix.ageAtReceiptMs > GPS_FRESH_MS) return null;
  return { coords: [...fix.position], source: 'GPS', capturedAt: fix.receivedAt };
}`;
  const newFunc = `// Kept under its existing exported name for callers. Only satellite-confirmed
// DATA telemetry may be used if a fresh FUS fix is unavailable. No cached/stale GPS.
export function freshFusionStart(fix, now = Date.now()) {
  if (!fix || !['fusion', 'telemetry'].includes(fix.source) || fix.valid !== true ||
      !validPoint(fix.position) || !Number.isFinite(fix.receivedAt) ||
      !Number.isFinite(fix.ageAtReceiptMs) || fix.receivedAt > now ||
      fix.ageAtReceiptMs < 0 || now - fix.receivedAt + fix.ageAtReceiptMs > GPS_FRESH_MS ||
      (fix.source === 'telemetry' && (!Number.isInteger(fix.satsLocked) || fix.satsLocked < 1))) {
    return null;
  }
  return { coords: [...fix.position], source: 'GPS', capturedAt: fix.receivedAt,
    fixSource: fix.source };
}

// Prefer authoritative FUS; otherwise reuse the same fresh GPS that drives
// Field Map's rover pin, explicitly marked 'telemetry' rather than 'fusion'.
export function choosePlanningGps(fus, telemetry, now = Date.now()) {
  if (fus?.source === 'fusion' && freshFusionStart(fus, now)) return fus;
  if (telemetry?.source === 'telemetry' && freshFusionStart(telemetry, now)) return telemetry;
  return fus ?? null;
}`;
  text = replaceOne(text, oldFunc, newFunc, 'fresh GPS validation');
  text = replaceOne(text, `if (!current || current.capturedAt !== start.capturedAt ||
        current.coords.some((value, i) => value !== start.coords[i])) {`, `if (!current || current.capturedAt !== start.capturedAt ||
        current.fixSource !== start.fixSource ||
        current.coords.some((value, i) => value !== start.coords[i])) {`, 'submit-time GPS provenance revalidation');
  return text;
}
function updateDialog(text) {
  text = replaceOneRegex(text, /^(import \{[^}\n]*freshFusionStart[^}\n]*\} from '\.\.\/utils\/pointToPointMission\.js';)$/m, `$1\n// ${MARKER}`, 'mission dialog import');
  const oldStatus = `  const gpsStatus = !gps ? 'No FUS navigation GPS received from the desktop receiver yet.'
    : gps.valid !== true ? 'The latest FUS navigation message has no valid GPS fix.'
    : gps.source !== 'fusion' ? 'Navigation GPS source is not validated FUS data.'
    : !gpsStart ? 'The last FUS GPS fix is stale or invalid (5-second freshness limit).'
    : 'Fresh GPS available. You may still override it with a map-selected position to correct drift.';`;
  const newStatus = `  const gpsStatus = !gps ? 'No recent GPS received from the desktop receiver. Check the LoRa connection or select Point A on the map.'
    : !gpsStart ? 'No valid fresh GPS fix (5-second limit). Check satellite lock or use a manually selected map position.'
    : gpsStart.fixSource === 'fusion' ? 'Fresh validated FUS navigation GPS available.'
    : 'Fresh GPS from live DATA telemetry (' + gps.satsLocked + ' satellites). FUS unavailable; verify rover position before planning.';`;
  text = replaceOne(text, oldStatus, newStatus, 'GPS status text');
  text = replaceOne(text, `origin === 'GPS' ? 'Validated FUS GPS fix' : 'Operator estimate (not GPS)'`, `origin === 'GPS' ? (gpsStart?.fixSource === 'fusion' ? 'Validated FUS GPS fix' : 'Live rover GPS telemetry (not fused)') : 'Operator estimate (not GPS)'`, 'GPS provenance label');
  return text;
}
function updateField(text) {
  text = replaceOne(text, `import { operatorMapStart } from '../utils/pointToPointMission.js';`, `import { operatorMapStart, choosePlanningGps } from '../utils/pointToPointMission.js';\n// ${MARKER}`, 'Field Map helper import');
  const oldPlanning = `  const [roverPos, setRoverPos] = useState(null);
  const [roverHeading, setRoverHeading] = useState(null);
  const planningGps = receiverStatus.connected && !receiverStatus.connectionError
    ? receiverStatus.planning_gps?.current ?? null : null;`;
  const newPlanning = `  const [roverPos, setRoverPos] = useState(null);
  const [roverHeading, setRoverHeading] = useState(null);
  // Field Map and Point A now consume the same satellite-confirmed DATA fix.
  // FUS remains preferred for navigation whenever it is fresh and valid.
  const [telemetryNavGps, setTelemetryNavGps] = useState(null);
  const planningGps = receiverStatus.connected && !receiverStatus.connectionError
    ? choosePlanningGps(receiverStatus.planning_gps?.current ?? null, telemetryNavGps)
    : null;`;
  text = replaceOne(text, oldPlanning, newPlanning, 'Field Map planning GPS binding');
  text = replaceOne(text, `      setRoverPos(null); setRoverHeading(null);
      clearTimeout(gpsExpiry.current);`, `      setRoverPos(null); setRoverHeading(null);
      setTelemetryNavGps(null);
      clearTimeout(gpsExpiry.current);`, 'disconnect cleanup');
  const gpsBranch = `      if (hasValidGps) {
        setRoverPos([lat, lng]);
        clearTimeout(gpsExpiry.current);
        gpsExpiry.current = setTimeout(() => { setRoverPos(null); setRoverHeading(null); }, 5000);
      } else {
        clearTimeout(gpsExpiry.current);
        setRoverPos(null); setRoverHeading(null);
      }`;
  const gpsReplacement = `      if (hasValidGps) {
        // DATA has an actual satellite lock and nonzero coordinates; never
        // manufacture a GPS fix from map pins or previous readings.
        setTelemetryNavGps({ source: 'telemetry', valid: true,
          position: [lat, lng], satsLocked: Number(data.satsLocked),
          receivedAt: Date.now(), ageAtReceiptMs: 0 });
        setRoverPos([lat, lng]);
        clearTimeout(gpsExpiry.current);
        gpsExpiry.current = setTimeout(() => { setRoverPos(null); setRoverHeading(null); }, 5000);
      } else {
        setTelemetryNavGps(null);
        clearTimeout(gpsExpiry.current);
        setRoverPos(null); setRoverHeading(null);
      }`;
  text = replaceOne(text, gpsBranch, gpsReplacement, 'Field Map DATA GPS listener');
  return text;
}
const PATCHES = [
  ['apps/desktop/src/utils/pointToPointMission.js', updateHelper],
  ['apps/desktop/src/components/PointToPointMissionDialog.jsx', updateDialog],
  ['apps/desktop/src/views/FieldMapView.jsx', updateField],
];
function apply(root, dryRun=false, output=console.log) {
  const planned = [];
  for (const [relative, updater] of PATCHES) {
    const p = path.resolve(root, relative);
    if (!p.startsWith(path.resolve(root) + path.sep)) fail(`Path escapes project: ${relative}`);
    if (!fs.existsSync(p)) fail(`Missing ${relative}; no changes made.`);
    const original = fs.readFileSync(p, 'utf8');
    if (original.includes(MARKER)) { planned.push({relative,p,already:true}); continue; }
    const crlf = original.includes('\r\n');
    const normalized = original.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const updated = updater(normalized);
    planned.push({relative,p,original,updated: crlf ? updated.replace(/\n/g,'\r\n') : updated,already:false});
  }
  for (const entry of planned) output(`${entry.already ? 'ALREADY PATCHED' : dryRun ? 'WOULD PATCH' : 'PATCH'}: ${entry.relative}`);
  if (dryRun || planned.every(p=>p.already)) { output(dryRun ? 'Dry run complete; no files changed.' : 'Already installed; no files changed.'); return planned; }
  const backupDir = path.join(__dirname, 'backups', new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backupDir, {recursive:true});
  for (const entry of planned.filter(p=>!p.already)) {
    const backup = path.join(backupDir, entry.relative);
    fs.mkdirSync(path.dirname(backup), {recursive:true});
    fs.writeFileSync(backup, entry.original);
  }
  const changed=[];
  try {
    for (const entry of planned.filter(p=>!p.already)) {
      const temp=entry.p+'.gps-fix-tmp';
      fs.writeFileSync(temp, entry.updated);
      try { fs.renameSync(temp, entry.p); } catch(e) { try{fs.unlinkSync(temp)}catch{}; throw e; }
      changed.push(entry);
    }
  } catch (error) {
    for (const entry of changed.reverse()) fs.writeFileSync(entry.p, entry.original);
    fail(`Installation failed and changed files were restored from backups: ${error.message}`);
  }
  output(`Done. Backups: ${path.relative(root,backupDir) || backupDir}`);
  output('Only React GPS planning files changed. Mega, rover ESP32, desktop RX, Rust, and database unchanged.');
  return planned;
}
if (require.main === module) {
  try {
    const args=process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const rootArg = args.find(arg=>arg!=='--dry-run' && !arg.startsWith('--')) || '.';
    const root=path.resolve(rootArg);
    apply(root,dryRun);
  } catch(error) { console.error('ERROR:',error.message); process.exitCode=1; }
}
module.exports={apply,updateHelper,updateDialog,updateField};
