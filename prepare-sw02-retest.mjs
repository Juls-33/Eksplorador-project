// Scoped configuration correction only. No database, firmware, dependencies or shared documents.
import { existsSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2),apply=args.includes('--apply');
if(args.some(a=>a.startsWith('--')&&a!=='--apply'))throw Error('Only --apply is supported');
const root=resolve(args.find(a=>!a.startsWith('--'))||process.cwd());
const desktop=existsSync(join(root,'apps/desktop/package.json'))?join(root,'apps/desktop'):root;
if(!existsSync(join(desktop,'package.json'))||!existsSync(join(desktop,'src')))throw Error('Run from Eksplorador-project or apps/desktop, or pass the project root path');
// App.jsx imports ./views/FieldMapView; the components copy is not active.
const appFile=join(desktop,'src/App.jsx');
if(!existsSync(appFile)||! /import\s+FieldMapView\s+from\s+['"]\.\/views\/FieldMapView(?:\.jsx)?['"]/.test(readFileSync(appFile,'utf8')))throw Error('App.jsx does not use the reviewed views/FieldMapView import; no files changed');
const file=join(desktop,'src/views/FieldMapView.jsx');
if(!existsSync(file))throw Error('Active src/views/FieldMapView.jsx is missing; no files changed');
const old=readFileSync(file,'utf8');
const tags=old.match(/<HeatmapMap\b[\s\S]*?\/>/g)?.filter(t=>t.includes('heatPoints={heatPointsForLayer}'))||[];
if(tags.length!==1)throw Error('Expected one Field Map heatmap call; no files changed');
const tag=tags[0];const prop=k=>Number(tag.match(new RegExp(k+'=\\{(\\d+)\\}'))?.[1]);
if(prop('maxInfluenceRadiusM')!==25||prop('minInterpolationNeighbors')!==2)throw Error('Search/neighbor settings differ from the reviewed version; no files changed');
const radius=prop('localCoverageRadiusM');if(![5,20].includes(radius))throw Error('Local radius differs from reviewed 5/20 m settings; no files changed');
const labels=[...old.matchAll(/Assumed coverage within (5|20) m of samples/g)];
if(labels.length!==1)throw Error('Expected one 5/20 m legend; no files changed');
console.log(`File: ${file}`);console.log(`Installed local=${radius} m, search=25 m, neighbors=2; legend=${labels[0][1]} m`);
let next=old.replace(tag,tag.replace('localCoverageRadiusM={5}','localCoverageRadiusM={20}'));
next=next.replace('Assumed coverage within 5 m of samples','Assumed coverage within 20 m of samples');
if(next===old){console.log('Already configured for 20 m. No change needed.');process.exit(0);}
if(!apply){console.log('PREVIEW ONLY: change localCoverageRadiusM from 5 to 20 and its legend from 5 m to 20 m.');console.log('To apply with a backup: node prepare-sw02-retest.mjs --apply');process.exit(0);}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=join(desktop,'sw02-backups',stamp);mkdirSync(backup,{recursive:true});
copyFileSync(file,join(backup,'FieldMapView.jsx'));
const hash=s=>createHash('sha256').update(s).digest('hex');
writeFileSync(join(backup,'change.json'),JSON.stringify({file,backupFile:join(backup,'FieldMapView.jsx'),beforeSHA256:hash(old),afterSHA256:hash(next),changed:['Field Map local radius 5 -> 20 m','Legend 5 -> 20 m']},null,2));
const temp=file+'.sw02-tmp';writeFileSync(temp,next);renameSync(temp,file);
console.log('Applied two scoped changes. geo.js, renderer, telemetry, mission logic, firmware and database were not modified.');
console.log(`Backup: ${backup}`);
