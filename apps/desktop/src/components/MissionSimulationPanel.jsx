import React, { useRef, useState } from 'react';
import { createRelativeMission } from '../utils/missionPlanning';
import { SupervisedMissionSimulation } from '../utils/supervisedMissionSimulation';

export default function MissionSimulationPanel({ waypoints }) {
  const simulator = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [origin, setOrigin] = useState('');
  const [heading, setHeading] = useState('0');
  const [observations, setObservations] = useState('{}');
  const [error, setError] = useState(null);
  const nextTime = () => Math.max(100, (simulator.current?.lastNow ?? 0) + 100);
  const example = sim => {
    const now = Math.max(100, sim.lastNow + 100);
    setObservations(JSON.stringify({encoderCalibrated:true, turnCalibrated:true, operatorApproved:true,
      forwardObstacle:false, rc:{valid:true, observedAt:now, authorized:true, mode:'HOLD'},
      gps:{valid:true, receivedAt:now, ageAtReceiptMs:0, position:sim.plan.origin},
      encoder:{valid:true, observedAt:now, step:sim.index + 1, targetReached:false}}, null, 2));
  };
  const stage = () => {
    try {
      const position = JSON.parse(origin);
      const plan = createRelativeMission({waypoints, gps:{position, valid:true, receivedAt:0, ageAtReceiptMs:0},
        heading:Number(heading), headingConfirmed:true, calibrationConfirmed:true, now:0});
      simulator.current = new SupervisedMissionSimulation(plan);
      setSnapshot(simulator.current.snapshot()); example(simulator.current); setError(null);
    } catch (reason) { setError(String(reason.message)); }
  };
  const step = action => {
    try { setSnapshot(simulator.current.step(nextTime(), JSON.parse(observations), action)); setError(null); }
    catch (reason) { setError(String(reason.message)); }
  };
  return <details style={{padding:12, background:'#f8fafc', borderRadius:8, marginTop:12}}>
    <summary>A3.0 supervised movement simulation · no hardware commands</summary>
    <p>Uses synthetic observations and the same route limits as deployment. Thresholds are illustrative. This model cannot calibrate hardware or save soil readings.</p>
    <label>Synthetic origin [latitude, longitude] <input value={origin} placeholder="[14.609,120.989]" onChange={e => setOrigin(e.target.value)}/></label>{' '}
    <label>Synthetic true-north heading <input type="number" min="0" max="359.999" value={heading} onChange={e => setHeading(e.target.value)}/></label>{' '}
    <button onClick={stage} disabled={!waypoints.length || !origin.trim() || !heading.trim()}>Stage new simulation</button>
    {snapshot && <>
      <p role="status">{snapshot.report.state} · step {snapshot.step} · {snapshot.token || 'End'} · {snapshot.reason || 'No hold'} · next time: {nextTime()} ms</p>
      <p>Physical drive, extension and retraction outputs: disabled.</p>
      <p>Observe authorized HOLD first, then edit RC mode to SEMI_AUTO. Encoder target completion requires a fresh observation for the current step. At each W, provide the checkpoint GPS position. Missing GPS must hold; clearing an obstacle never resumes movement.</p>
      <label>Synthetic observations (JSON)
        <textarea style={{width:'100%', height:220, fontFamily:'monospace'}} value={observations} onChange={e => setObservations(e.target.value)}/>
      </label>
      <button onClick={() => example(simulator.current)}>Load HOLD observations for next step</button>{' '}
      <p>A3.0 clears the active mission on HOLD; intervention and a new staged mission are required.</p>
      {['tick','cancel'].map(action => <button key={action} onClick={() => step(action)}>{action}</button>)}
      <pre style={{overflow:'auto', maxHeight:180}}>{JSON.stringify(snapshot, null, 2)}</pre>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
