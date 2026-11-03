import React, { useRef, useState } from 'react';
import { createWaypointPlan, MissionSimulation } from '../utils/missionSimulation';

export default function MissionSimulationPanel({ waypoints }) {
  const simulator = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [tolerance, setTolerance] = useState(3);
  const [confidence, setConfidence] = useState(0.95);
  const [observations, setObservations] = useState('{}');
  const [error, setError] = useState(null);
  const nextTime = () => Math.max(100, (simulator.current?.lastNow ?? 0) + 100);
  const example = sim => {
    const now = Math.max(100, sim.lastNow + 100), wp = sim.plan.waypoints[sim.index];
    setObservations(JSON.stringify({operatorApproved:true, calibrationValidated:true, obstacleClear:true,
      gps:{valid:true, observedAt:now, position:wp.coordinates, confidence:1, uncertaintyM:0.5},
      drive:{valid:true, observedAt:now, stopped:true}, encoder:{valid:true, observedAt:now},
      imu:{valid:true, observedAt:now, tiltDegrees:0}, contact:{valid:true, observedAt:now},
      clearance:{valid:true, observedAt:now, mechanism:'SUPERVISED_CLEARANCE', operatorApproved:true},
      sample:{valid:true, observedAt:now, requestId:wp.samplingRequestId,
        values:{ph:7, moisture:30, ec:100, nitrogen:10, phosphorus:10, potassium:10}}}, null, 2));
  };
  const stage = () => {
    try {
      const plan = createWaypointPlan(`SIM-${crypto.randomUUID()}`, waypoints,
        {arrivalToleranceM:Number(tolerance), requiredConfidence:Number(confidence), maxUncertaintyM:Math.min(1, Number(tolerance))});
      simulator.current = new MissionSimulation(plan);
      setSnapshot(simulator.current.snapshot()); example(simulator.current); setError(null);
    } catch (reason) { setError(String(reason.message)); }
  };
  const step = action => {
    try { setSnapshot(simulator.current.step(nextTime(), JSON.parse(observations), action)); setError(null); }
    catch (reason) { setError(String(reason.message)); }
  };
  return <details style={{padding:12, background:'#f8fafc', borderRadius:8, marginTop:12}}>
    <summary>Autonomous sampling simulation · no hardware commands</summary>
    <p>This model uses a frozen copy of the pins and editable synthetic observations. Example values and thresholds are for simulation only. Nothing is sent or saved as a soil reading.</p>
    <label>Arrival tolerance (m) <input type="number" min="0.1" step="0.1" value={tolerance} onChange={e => setTolerance(e.target.value)}/></label>{' '}
    <label>Required confidence <input type="number" min="0.01" max="1" step="0.01" value={confidence} onChange={e => setConfidence(e.target.value)}/></label>{' '}
    <button onClick={stage} disabled={!waypoints.length}>Stage new simulation</button>
    {snapshot && <>
      <p role="status">{snapshot.phase} · waypoint {snapshot.index + 1} · {snapshot.reason || 'No hold'} · simulation time for next step: {nextTime()} ms</p>
      <p>Physical drive, extension and retraction outputs: disabled.</p>
      <label>Synthetic observations (JSON)
        <textarea style={{width:'100%', height:180, fontFamily:'monospace'}} value={observations} onChange={e => setObservations(e.target.value)}/>
      </label>
      <button onClick={() => example(simulator.current)}>Load example observations for next step</button>{' '}
      {['authorize','tick','pause','recover','abort','manualOverride'].map(action =>
        <button key={action} onClick={() => step(action)}>{({authorize:'Authorize simulation', tick:'Advance simulation', pause:'Pause', recover:'Recover with authorization', abort:'Abort', manualOverride:'Manual override'})[action]}</button>)}
      <pre style={{overflow:'auto', maxHeight:180}}>{JSON.stringify(snapshot.waypoints, null, 2)}</pre>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
