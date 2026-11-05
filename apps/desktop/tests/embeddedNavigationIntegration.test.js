import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWaypointMission,missionWaypointEvidence} from '../src/utils/waypointMission.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const run=(command,args,options={})=>{
  const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:240000,windowsHide:true,...options});
  assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);return r.stdout;
};
test('actual C++ RC/controller regressions pass and receiver output survives native parsing and waypoint evidence mapping',()=>{
  mkdirSync(join(root,'.pio/navigation-checks'),{recursive:true});
  if(process.platform==='win32')run('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File','embedded/tests/CheckNavigation.ps1','-HostOnly']);
  else for(const name of ['navigation_test','rc_safety_test']){
    run('g++',['-std=c++11','-Wall','-Wextra','-pedantic','-Iembedded/shared',`embedded/tests/${name}.cpp`,'-o',`.pio/navigation-checks/${name}.exe`]);
    run(join(root,`.pio/navigation-checks/${name}.exe`),[]);
  }
  const binary=join(root,'.pio/navigation-checks/navigation_test.exe');
  const status=run(binary,['--status-json']);
  const telemetry=run(binary,['--navigation-json']);
  const folder=mkdtempSync(join(tmpdir(),'eksplorador-nav-'));
  try{
    const path=join(folder,'receiver.jsonl');writeFileSync(path,status+telemetry);
    const frames=run('cargo',['run','--locked','--offline','--quiet','--example','replay_telemetry','--',path],
      {cwd:join(root,'apps/desktop/src-tauri')}).trim().split(/\r?\n/).map(JSON.parse);
    const events=frames.flatMap(f=>f.events);
    const reports=events.filter(e=>e.event==='mission-status').map(e=>e.payload);
    assert.equal(reports.filter(s=>s.state==='PIN_CHECKED'&&s.reason==='GPS_WITHIN_5M').length,2);
    const plan=createWaypointMission([[14.609,120.989],[14.6091,120.9891]]);
    const evidence=missionWaypointEvidence({sequence:plan.sequence,status_history:reports});
    assert.equal(evidence.length,2);assert.ok(evidence.every(w=>w.evidence==='GPS verification reported'));
    assert.ok(missionWaypointEvidence({sequence:plan.sequence,status_history:reports.filter(s=>s.state!=='PIN_CHECKED')}).every(w=>w.evidence==='Waypoint arrival unverified'));
    const nav=events.filter(e=>e.event==='navigation-data').map(e=>e.payload);
    assert.equal(nav.length,3);assert.equal(nav[0].bootId,100);
    assert.equal(nav[0].receiverVersion,30100);
    assert.equal(nav.at(-1).type,'navigationCalibration');
    assert.ok(events.every(e=>!['sensor-data','encoder-data','fusion-data'].includes(e.event)));
  }finally{rmSync(folder,{recursive:true,force:true});}
});
