import React,{useEffect,useState} from 'react';
import {describeMissionStatus,missionEvidence,missionStepEvidence} from '../utils/missionStatus';

export default function MissionStatusReport({deployment,connected,advanced=false}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 if(!deployment)return null;const status=deployment.mega_status;
 if (deployment.sequence?.startsWith('TF')) return <section role="status" aria-live="polite" style={{padding:12,background:'#f4f7f5',borderRadius:8}}>
   <strong>One-leg movement delivery</strong>
   <p>Forward instruction: <code>{deployment.sequence}</code></p>
   <p>Radio transmission: {deployment.transmitted_attempts > 0 ? 'Observed' : 'Not confirmed'} · ACK2: {deployment.acknowledged ? 'Rover reported UART queue delivery' : 'Not confirmed'}</p>
   <p>Mega staging, movement and arrival at Point B are not proved by a radio ACK. Observe the rover and use CH6 HOLD / CH5 DISARM to intervene.</p>
   {deployment.error && <p role="alert">{deployment.error}</p>}
 </section>;

 return <section role="status" aria-live="polite" style={{padding:12,background:'#f4f7f5',borderRadius:8}}>
  <strong>Mission delivery and rover events</strong><p>{describeMissionStatus(deployment)}</p>
  {status&&(!connected||!deployment.status_connection_confirmed)&&<p>Historical report; awaiting confirmation after reconnection.</p>}
  {status&&(!deployment.status_received_at_ms||now-deployment.status_received_at_ms>10000)&&<p>Report freshness is unconfirmed or older than 10 seconds. Current execution and arrival are unverified; no automatic resume is sent.</p>}
  {deployment.status_packets_missing>0&&<p>Some mission events were missed. Unobserved movement and waypoint arrivals remain unverified.</p>}
  <ol>{missionStepEvidence(deployment).map(s=><li key={s.step}>Pin {s.pin||s.step}: {s.evidence}</li>)}</ol>
  {advanced&&<details><summary>Communication and status diagnostics</summary>
   <p>Mission {status?.missionId||deployment.mission_key} · revision {status?.statusSeq??'unreported'} · missed revisions {deployment.status_packets_missing||0} · evicted history {deployment.status_history_dropped||0}</p>
   <dl>{missionEvidence(deployment).map(([label,evidence])=><React.Fragment key={label}><dt>{label}</dt><dd>{evidence}</dd></React.Fragment>)}</dl>
   <ol>{(deployment.status_history||[]).map(s=><li key={s.statusSeq}>Revision {s.statusSeq} · waypoint {s.step}: {s.state} / {s.reason}</li>)}</ol>
  </details>}
 </section>;
}
