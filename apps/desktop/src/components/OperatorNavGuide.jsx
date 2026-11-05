import React, {useState} from 'react';
import {createWaypointMission,readHeadingReference,HEADING_REFERENCE_KEY} from '../utils/waypointMission';

export default function OperatorNavGuide({waypoints=[],onSendMission,missionDeploymentPending=false,currentWaypointIdx=0,onAdvanceWaypoint=null}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  let plan,error;
  try {plan=createWaypointMission(waypoints,{initialHeading:readHeadingReference()?.heading??null});}catch(reason){error=reason.message;}
  return <section className="card" style={{padding:16}} aria-label="Send waypoint mission">
    <h3>Send Mission</h3>
    <p>Review the pins in order, then send their coordinates to the rover. GPS is not needed for delivery.</p>
    <ol>{waypoints.map((point,index)=><li key={index}>Pin {index+1}: {point?.[0]?.toFixed?.(6)??'Invalid'}, {point?.[1]?.toFixed?.(6)??'Invalid'}</li>)}</ol>
    {plan&&<p>{plan.legs.length} waypoint targets · {plan.sequence.length}/226 bytes</p>}
    {error&&<p role="alert">{error}</p>}
    <button disabled={!plan||!onSendMission||busy||missionDeploymentPending} onClick={async()=>{
      if(!plan||busy||missionDeploymentPending)return;setBusy(true);setMessage('');
      try {const frozen=createWaypointMission(waypoints,{initialHeading:readHeadingReference()?.heading??null});
        await onSendMission(frozen);globalThis.localStorage?.removeItem(HEADING_REFERENCE_KEY);setMessage('Sending waypoint targets. Wait for delivery and Mega staging evidence.');
      }catch(reason){setMessage(String(reason.message||reason));}finally{setBusy(false);}
    }}>{busy?'Opening upload...':'Send Mission'}</button>
    <p>Sending only stages the mission. Physical movement requires live GPS, a usable heading estimate, measured calibration, RC authorization and a deliberate RC HOLD-to-SEMI_AUTO transition. Use RC HOLD/DISARM to stop.</p>
    {onAdvanceWaypoint&&waypoints[currentWaypointIdx]&&<button onClick={onAdvanceWaypoint}>Mark guide pin {currentWaypointIdx+1} manually</button>}
    <p>Guide marks and saved soil samples do not establish onboard waypoint arrival. Heading setup, calibration and advanced simulation are in Developer Tools.</p>
    {message&&<p role="status">{message}</p>}
  </section>;
}
