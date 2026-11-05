import React, { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { missionExperiment, useMissionExperiment } from '../hooks/useMissionExperiment';

export default function MissionExperimentPanel() {
  const session = useMissionExperiment();
  const [error, setError] = useState(null);
  if (!session.plan) return null;
  const exportLog = async () => {
    try {
      const path = await save({defaultPath:'eksplorador-a3-calibration.json', filters:[{name:'Calibration JSON', extensions:['json']}]});
      if (path) await writeTextFile(path, JSON.stringify(missionExperiment.export(), null, 2));
      setError(null);
    } catch (reason) { setError(String(reason)); }
  };
  return <section style={{padding:12, background:'#f8fafc', marginTop:12}} aria-label="A3.0 calibration recording">
    <strong>Expected route and actual observations</strong>
    <p>{session.recording ? 'Recording' : 'Recording stopped'} · {session.count} observations · mission {session.missionId || 'not prepared'}</p>
    <p>Recording continues across desktop pages. Export before closing the app. Accepted GPS, encoder, pose and mission events retain receipt times. Previous runs are archived automatically: {session.archives||0}/5; dropped archives: {session.archiveDrops||0}. Comparison radius: 3 m for inspection only; this does not certify arrival.</p>
    <table><thead><tr><th>Pin</th><th>Expected latitude</th><th>Expected longitude</th></tr></thead>
      <tbody>{session.plan.legs.map(w => <tr key={w.pin}><td>{w.pin}</td><td>{w.coordinates[0].toFixed(6)}</td><td>{w.coordinates[1].toFixed(6)}</td></tr>)}</tbody></table>
    {session.dropped > 0 && <p role="alert">Recording full (10,000 observations). {session.dropped} later records were not captured. Export and start a new recording.</p>}
    <button onClick={exportLog}>Export current and archived runs (JSON)</button>{' '}
    {session.recording ? <button onClick={() => missionExperiment.stop()}>Stop recording</button>
      : <button onClick={() => missionExperiment.clear()}>Clear current and archived recordings</button>}
    <p>Stop recording and Clear affect this log only. Use RC HOLD/DISARM to stop movement.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
