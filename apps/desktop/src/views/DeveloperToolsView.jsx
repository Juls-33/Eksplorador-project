import React,{useState} from 'react';
import {useLoRaConnection} from '../hooks/useLoRaConnection';
import {useMissionExperiment} from '../hooks/useMissionExperiment';
import {HEADING_REFERENCE_KEY,formatFirmwareVersion} from '../utils/waypointMission';
import MissionSimulationPanel from '../components/MissionSimulationPanel';
import MissionExperimentPanel from '../components/MissionExperimentPanel';
import DrivetrainTelemetry from '../components/DrivetrainTelemetry';
import MissionStatusReport from '../components/MissionStatusReport';

export default function DeveloperToolsView(){
 const radio=useLoRaConnection(),run=useMissionExperiment();
 const [heading,setHeading]=useState(''),[message,setMessage]=useState('');
 const [coordinates,setCoordinates]=useState('');let points=run.plan?.legs.map(w=>w.coordinates)||[];
 if(coordinates.trim())try{points=JSON.parse(coordinates);}catch{points=[];}
 const n=radio.navigation,c=radio.navigation_calibration;
 return <div style={{padding:24,display:'grid',gap:18}}>
  <h1>Developer Tools</h1>
  <section className="card" style={{padding:16}}><h2>Reported firmware and calibration</h2>
   <p>Mega: {formatFirmwareVersion(n?.megaVersion)} · Rover: {formatFirmwareVersion(n?.roverVersion)} · Receiver: {formatFirmwareVersion(n?.receiverVersion)}</p>
   <p>Calibration revision: {c?.revision??'Unreported'} · {c?.valid?'Validated stored profile reported':'No valid stored calibration reported'}. Readiness comes from board telemetry.</p>
   <pre style={{overflow:'auto'}}>{JSON.stringify(c||{},null,2)}</pre>
   <p>Connect the Mega USB console at 115200 baud for calibration. These commands record manual RC trials; they never drive motors.</p>
   <ol>
    <li>HOLD/DISARM, loaded rover stationary: <code>CAL ZERO</code>. Wait at least 3 seconds, then <code>CAL END 0</code>.</li>
    <li><code>CAL BEGIN STRAIGHT</code>. Drive manually with RC, measure loaded travel, return HOLD/DISARM, then <code>CAL END 1.0</code> (replace 1.0 with measured meters). Repeat twice.</li>
    <li><code>CAL BEGIN LEFT</code> or <code>CAL BEGIN RIGHT</code>. Turn manually, measure actual degrees, return HOLD/DISARM, then <code>CAL END 90</code> (replace with measured degrees). Perform two left and two right trials.</li>
    <li><code>CAL SAVE</code> validates repeatability and writes the inactive EEPROM slot with CRC/readback. Reboot, inspect <code>CAL STATUS</code> and the reported profile here.</li>
   </ol>
   <p>Do not substitute nominal wheel dimensions, unloaded travel or invented constants. Keep the probe retracted. Wrong polarity, unstable gyro bias and inconsistent trials are rejected.</p>
  </section>
  <section className="card" style={{padding:16}}><h2>Initial true-north heading</h2>
   <p>Place the rover at its starting position. Measure its compass heading relative to true north. Confirm it here for the next mission, or use <code>NAV HEADING 90</code> on the disarmed Mega console after staging. GPS course does not initialize heading.</p>
   <label>Measured heading (degrees) <input type="number" min="0" max="359.999" value={heading} onChange={e=>setHeading(e.target.value)}/></label>
   <button disabled={!heading.trim()||!Number.isFinite(Number(heading))||Number(heading)<0||Number(heading)>=360} onClick={()=>{
    globalThis.localStorage?.setItem(HEADING_REFERENCE_KEY,JSON.stringify({heading:Number(heading),confirmedAt:Date.now()}));
    setMessage('Operator heading reference recorded for the next mission upload (expires in 5 minutes). Keep the rover stationary until execution.');
   }}>Confirm measured heading for next mission</button>
   <p role="status">{message}</p>
  </section>
  <MissionExperimentPanel/>
  <DrivetrainTelemetry/>
  <MissionStatusReport deployment={radio.deployment} connected={radio.connected} advanced/>
  <section className="card" style={{padding:16}}><h2>Advanced diagnostics</h2>
   <p>The hardware uses the portable C++ estimator/controller. Run embedded/tests/CheckNavigation.ps1 for its simulations. The legacy relative-command model below is retained as an isolated research tool and cannot send hardware commands.</p>
   <label>Optional synthetic pin coordinates (JSON)<textarea value={coordinates} onChange={e=>setCoordinates(e.target.value)} style={{width:'100%'}}/></label>
   <MissionSimulationPanel waypoints={Array.isArray(points)?points:[]}/>
   <pre style={{overflow:'auto',maxHeight:260}}>{JSON.stringify(n||{},null,2)}</pre>
  </section>
 </div>;
}
