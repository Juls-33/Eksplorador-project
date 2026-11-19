#!/usr/bin/env node
'use strict';
/**
 * Eksplorador obstacle-alert patch installer (Node.js, no npm dependencies).
 * Matches the previously shipped Python installer. Mega and RX_BOARD are untouched.
 * Usage: node apply_obstacle_alert.js <project-root> [--dry-run] [--rover <relative .ino>]
 */
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const MARKER = 'EKSPLORADOR_OBSTACLE_ALERT_V1';
const payload = (file) => fs.readFileSync(path.join(HERE, 'payload', file), 'utf8');
const roverGlobals = payload('rover_globals.txt');
const roverTx = payload('rover_tx.txt');
const rustEmit = payload('rust_emit.txt');

function fail(message) { throw new Error(message); }
function exists(file) { return fs.existsSync(file) && fs.statSync(file).isFile(); }
function read(file) { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
function replaceOnce(body, needle, replacement, label) {
  const count = body.split(needle).length - 1;
  if (count !== 1) fail(`${label}: expected exactly one anchor, got ${count}. No project files changed.`);
  return body.replace(needle, replacement);
}
function patchRover(body) {
  if (body.includes(MARKER)) return body;
  body = replaceOnce(body, 'void processMegaLine(const char *s) {',
    roverGlobals + '\nvoid processMegaLine(const char *s) {', 'Rover ESP32: processMegaLine');
  body = replaceOnce(body, 'Serial.println(s + 15);',
    'Serial.println(s + 15);\n      queueObstacleAlert(s);', 'Rover ESP32: MISSION_STATUS');
  body = replaceOnce(body, 'void serviceTx() {',
    roverTx + '\nvoid serviceTx() {', 'Rover ESP32: serviceTx');
  // Insert directly before the serviceTx() statement in loop(), inside the
  // existing TX branch. The old installer wrongly required exactly two blank
  // lines after serviceTx(); real rover sketches have different formatting.
  // Never match a definition or unbraced inline if statement here.
  const loopAnchors = [...body.matchAll(/\bvoid\s+loop\s*\(\s*\)\s*\{/g)];
  if (loopAnchors.length !== 1)
    fail(`Rover ESP32: expected exactly one loop() definition, got ${loopAnchors.length}. No project files changed.`);
  const loopStart = loopAnchors[0].index + loopAnchors[0][0].length;
  const laterBody = body.slice(loopStart);
  const txCalls = [...laterBody.matchAll(/^([ \t]*)serviceTx\s*\(\s*\)\s*;/gm)];
  if (txCalls.length !== 1)
    fail(`Rover ESP32: expected one standalone serviceTx() call in loop(), got ${txCalls.length}. No project files changed.`);
  const txCall = txCalls[0];
  const insertAt = loopStart + txCall.index;
  const inserted = `${txCall[1]}if (serviceObstacleAlert()) { delay(1); return; }\n`;
  body = body.slice(0, insertAt) + inserted + body.slice(insertAt);
  return body;
}
function patchRust(body) {
  if (body.includes(MARKER)) return body;
  body = `mod obstacle_alert; // ${MARKER}\n` + body;
  return replaceOnce(body, '                                match encoder_telemetry::classify(trimmed) {',
    rustEmit + '\n                                match encoder_telemetry::classify(trimmed) {',
    'Tauri lib.rs: serial telemetry classification');
}
function patchEntry(body) {
  if (body.includes(MARKER)) return body;
  const re = /<App\s*\/>/g;
  const matches = body.match(re) || [];
  if (matches.length !== 1) fail(`React entry: expected exactly one <App />, found ${matches.length}`);
  return `import RoverObstacleAlert from './components/RoverObstacleAlert'; // ${MARKER}\n` +
    body.replace(re, '<><App /><RoverObstacleAlert /></>');
}
function listIno(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    if (ent.isSymbolicLink()) continue;
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) listIno(file, output);
    else if (ent.isFile() && file.toLowerCase().endsWith('.ino') && fs.statSync(file).size <= 250000) output.push(file);
  }
  return output;
}
function locateRover(root) {
  const candidates = listIno(path.join(root, 'embedded')).filter(file => {
    const s = read(file);
    return s.includes('void processMegaLine(const char *s)') &&
      s.includes('void serviceMissionForward()') && s.includes('LoRa.parsePacket()');
  });
  if (candidates.length !== 1) fail(
    `Expected one rover ESP32 sketch under embedded/, found ${candidates.length}:\n` +
    (candidates.map(x => `  ${path.relative(root, x)}`).join('\n') || '(none)') +
    '\nUse --rover "embedded\\path\\your-current-rover.ino" to choose the currently flashed source.'
  );
  return candidates[0];
}
function parseArgs(argv) {
  let projectRoot = null, rover = null, dryRun = false;
  for (let i=0; i<argv.length; i++) {
    const item=argv[i];
    if (item==='--dry-run') dryRun=true;
    else if (item==='--rover') {
      if (rover !== null || !argv[i+1]) fail('Provide one .ino path after --rover');
      rover=argv[++i];
    } else if (item==='--help' || item==='-h') {
      process.stdout.write('Usage: node apply_obstacle_alert.js <project-root> [--dry-run] [--rover <relative .ino>]\n');
      process.exit(0);
    } else if (item.startsWith('-')) fail(`Unknown option: ${item}`);
    else if (projectRoot===null) projectRoot=item;
    else fail(`Unexpected argument: ${item}`);
  }
  return { root:path.resolve(projectRoot || '.'), rover, dryRun };
}
function underRoot(root, file) {
  const rel=path.relative(root,file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel);
}
function main() {
  const {root, rover: roverArg, dryRun} = parseArgs(process.argv.slice(2));
  const tauri = path.join(root, 'apps','desktop','src-tauri','src','lib.rs');
  const src=path.join(root,'apps','desktop','src');
  const entry = ['main.jsx','main.tsx','main.js'].map(f=>path.join(src,f)).find(exists);
  if (!exists(tauri) || !entry) fail(`Expected Tauri lib.rs and React main.jsx/tsx under ${root}`);
  let rover;
  if (roverArg) {
    rover = path.resolve(root, roverArg);
    if (!underRoot(root,rover) || !exists(rover) || path.extname(rover).toLowerCase()!=='.ino')
      fail('--rover must be an existing .ino inside the project.');
    const body=read(rover);
    for (const symbol of ['void processMegaLine(const char *s)', 'void serviceMissionForward()', 'void serviceTx()'])
      if (!body.includes(symbol)) fail(`Selected --rover file is missing ${symbol}`);
  } else rover = locateRover(root);
  // Fully preflight every patch anchor and existing custom file before writing ANY bytes.
  const changes = new Map([
    [rover, patchRover(read(rover))],
    [tauri, patchRust(read(tauri))],
    [entry, patchEntry(read(entry))],
    [path.join(path.dirname(tauri), 'obstacle_alert.rs'), payload('obstacle_alert.rs')],
    [path.join(src,'components','RoverObstacleAlert.jsx'), payload('RoverObstacleAlert.jsx')],
    [path.join(src,'components','RoverObstacleAlert.css'), payload('RoverObstacleAlert.css')]
  ]);
  const mainFiles = new Set([rover,tauri,entry]);
  for (const [file, content] of changes) {
    if (exists(file) && !mainFiles.has(file) && read(file)!==content)
      fail(`${path.relative(root,file)} already exists with different contents; no files changed.`);
  }
  const toChange = Array.from(changes).filter(([file,content])=> !exists(file) || read(file)!==content);
  if (!toChange.length) { console.log('Already installed; no files changed.'); return; }
  for (const [file] of toChange) console.log(`${dryRun?'WOULD PATCH':'PATCH'}: ${path.relative(root,file)}`);
  if (dryRun) { console.log('Dry run complete; no files changed.'); return; }
  for (const [file, content] of toChange) {
    fs.mkdirSync(path.dirname(file),{recursive:true});
    if (exists(file)) {
      const backup=file+'.before-obstacle-alert.bak';
      if (!fs.existsSync(backup)) fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
    }
    const temp=file+'.obstacle-alert.tmp';
    try { fs.writeFileSync(temp,content,'utf8'); fs.renameSync(temp,file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  console.log('Done. Arduino Mega and RX_BOARD sketches were not altered.');
  console.log('Next: npm run build, cargo test obstacle_alert --lib, and rover ESP32 Verify/flash when charged.');
}
try { main(); } catch(err) { console.error(`ERROR: ${err.message}`); process.exitCode=1; }
