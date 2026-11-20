#!/usr/bin/env node
'use strict';
/*
 * Eksplorador Live Monitoring GPS continuity, V1.
 * Strict, stdlib-only patch of App.jsx. Never edits firmware, telemetry,
 * soil sampling, mission control, backend, or the shared map component.
 * Requires the already-installed GPS Display Continuity V1 helper and map.
 */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'EKSPLORADOR_LIVE_MONITORING_GPS_CONTINUITY_V1';
const REL = 'apps/desktop/src/App.jsx';
const PRE_REQUISITES = [
  ['apps/desktop/src/hooks/useRoverDisplayPosition.js', ['useRoverDisplayPosition', 'resolveLastKnownGpsDisplay']],
  ['apps/desktop/src/utils/roverPositionDisplay.js', ['LAST_KNOWN_GPS_DISPLAY_MS', '30_000']],
  ['apps/desktop/src/components/HeatmapMap.jsx', ['roverPositionStatus', "roverPositionStatus === 'LAST_KNOWN'", 'setOpacity']],
  ['apps/desktop/src/views/FieldMapView.jsx', ['EKSPLORADOR_GPS_DISPLAY_CONTINUITY_V1', 'roverDisplay.position']],
];

function replaceExactlyOnce(text, regex, replacement, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one source anchor, found ${matches.length}. No files changed.`);
  }
  return text.replace(regex, replacement);
}
function patchApp(raw) {
  if (raw.includes(MARKER)) {
    const checks = [
      'useRoverDisplayPosition(',
      'liveMapDisplay.position',
      'roverPositionStatus={liveMapDisplay.mode}',
      "liveMapDisplay.mode === 'LAST_KNOWN'",
      'liveData?.seq',
    ];
    if (!checks.every(s => raw.includes(s))) {
      throw new Error('Live Monitoring contains an incomplete or conflicting existing patch. No files changed.');
    }
    return {output: raw, already: true};
  }
  const crlf = raw.includes('\r\n');
  let src = raw.replace(/\r\n/g, '\n');
  src = replaceExactlyOnce(src,
    /import\s*\{\s*useLoRaConnection\s*\}\s*from\s*['"]\.\/hooks\/useLoRaConnection['"]\s*;/,
    match => `${match}\nimport { useRoverDisplayPosition } from './hooks/useRoverDisplayPosition.js'; // ${MARKER}`,
    'App.jsx: LoRa hook import');

  src = replaceExactlyOnce(src,
    /const hasGpsFix\s*=\s*isConnected\s*&&\s*hasLiveGpsFix\(liveData\)\s*;/,
    match => `${match}\n
  // DISPLAY ONLY. Do not replace the live GPS validity value used by
  // monitoring, soil data, geotagging, or point-to-point planning.
  // Memoization prevents unrelated React re-renders from refreshing the
  // age of a GPS position that has NOT received a new telemetry packet.
  const liveMapGps = useMemo(
    () => hasGpsFix ? [Number(liveData.lat), Number(liveData.lng)] : null,
    [hasGpsFix, liveData?.seq, liveData?.lat, liveData?.lng]
  );
  const liveMapDisplay = useRoverDisplayPosition(
    liveMapGps,
    isConnected && receiverStatus.connected && !receiverStatus.connectionError
  );`,
    'App.jsx: independent map-only GPS data');

  src = replaceExactlyOnce(src,
    /roverPos\s*=\s*\{\s*!selectedHistoricalPos\s*&&\s*hasGpsFix\s*\?\s*\[\s*liveData\.lat\s*,\s*liveData\.lng\s*\]\s*:\s*null\s*\}/,
    `roverPos={!selectedHistoricalPos ? liveMapDisplay.position : null}\n                  roverPositionStatus={liveMapDisplay.mode}`,
    'App.jsx: Live Monitoring rover marker');

  src = replaceExactlyOnce(src,
    /(gpsWarning\s*=\s*\{\s*)!hasGpsFix\s*\?\s*!isConnected/,
    (_match, prefix) => `${prefix}!selectedHistoricalPos && liveMapDisplay.mode === 'LAST_KNOWN'
                      ? \`GPS temporarily unavailable — last known position \${Math.floor(liveMapDisplay.ageMs / 1000)}s old (not live GPS or dead reckoning).\`
                      : !hasGpsFix
                      ? !isConnected`,
    'App.jsx: Live Monitoring GPS warning');

  src = replaceExactlyOnce(src,
    /center\s*=\s*\{\s*selectedHistoricalPos\s*\|\|\s*\(\s*hasGpsFix\s*\?\s*\[\s*liveData\.lat\s*,\s*liveData\.lng\s*\]\s*:\s*latestDbPos\s*\|\|\s*\[\s*14\.6095\s*,\s*120\.9890\s*\]\s*\)\s*\}/,
    `center={selectedHistoricalPos || liveMapDisplay.position || latestDbPos || [14.6095, 120.9890]}`,
    'App.jsx: selected map center');

  if (!src.includes('last known position') || !src.includes('liveMapDisplay.ageMs')) {
    throw new Error('Internal patch validation failed; no files changed.');
  }
  return {output: crlf ? src.replace(/\n/g, '\r\n') : src, already: false};
}
function rootPath(root, relative) {
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error(`Illegal path: ${relative}`);
  return full;
}
function checkPrerequisites(root, readFile = f => fs.readFileSync(f, 'utf8')) {
  for (const [rel, terms] of PRE_REQUISITES) {
    const full = rootPath(root, rel);
    if (!fs.existsSync(full)) throw new Error(`Missing previously installed GPS continuity component: ${rel}. Install the earlier GPS continuity ZIP first; no files changed.`);
    const source = readFile(full);
    if (terms.some(t => !source.includes(t))) throw new Error(`GPS continuity prerequisite incompatible: ${rel}. No files changed.`);
  }
}
function main(rootArg='.', {dryRun=false, log=console.log}={}) {
  const root=path.resolve(rootArg);
  checkPrerequisites(root);
  const full=rootPath(root, REL);
  if (!fs.existsSync(full)) throw new Error(`Missing ${REL}; no files changed.`);
  const before=fs.readFileSync(full, 'utf8');
  const {output, already}=patchApp(before);
  log(`${already?'ALREADY PATCHED':dryRun?'WOULD PATCH':'PATCH'}: ${REL}`);
  if (already) { log('Existing Live Monitoring GPS fix validated; no files changed.'); return; }
  if (dryRun) { log('Dry run complete. Only App.jsx would be changed; no files changed.'); return; }
  const backupRoot=path.join(__dirname,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backupRoot,{recursive:true});
  const backup=path.join(backupRoot,'App.jsx');
  fs.writeFileSync(backup,before);
  try {
    fs.writeFileSync(full,output);
    // Post-commit verification; restore original on any failure.
    if (!patchApp(fs.readFileSync(full,'utf8')).already) throw new Error('Post-write verification failed');
  } catch(e) {
    fs.writeFileSync(full,before);
    throw new Error(`Patch failed and App.jsx was restored: ${e.message}`);
  }
  log('Done. Live Monitoring marker display only; no firmware, telemetry parsing, soil sampling, database or movement changes.');
  log(`Backup: ${backup}`);
}
if (require.main === module) {
  const args=process.argv.slice(2);
  const root=args.find(s=>!s.startsWith('--')) || '.';
  try{ main(root,{dryRun:args.includes('--dry-run')}); }
  catch(e){ console.error('ERROR: '+e.message); process.exitCode=1; }
}
module.exports={main,patchApp,checkPrerequisites,MARKER,REL};
