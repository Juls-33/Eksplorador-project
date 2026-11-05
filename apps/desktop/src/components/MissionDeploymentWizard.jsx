import React,{useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {refreshLoRaConnection,useLoRaConnection} from '../hooks/useLoRaConnection';
import {missionExperiment} from '../hooks/useMissionExperiment';
import {getDeploymentFailure,getDeploymentProgress,isReceiverUnavailable} from '../utils/loraStatus';
import LoRaConnectionStatus from './LoRaConnectionStatus';
import MissionStatusReport from './MissionStatusReport';
import './MissionDeploymentWizard.css';

export default function MissionDeploymentWizard({plan,onClose}){
 const radio=useLoRaConnection(),session=useRef(null),starting=useRef(null),mounted=useRef(false),cleanup=useRef(null),acting=useRef(false),confirmRequested=useRef(false);
 const [actionRevision,setActionRevision]=useState(0);
 const [id,setId]=useState(null),[error,setError]=useState(null),[closing,setClosing]=useState(false);
 const deployment=radio.deployment?.id===id?radio.deployment:null,phase=deployment?.phase;
 useEffect(()=>{mounted.current=true;clearTimeout(cleanup.current);return()=>{mounted.current=false;
  cleanup.current=setTimeout(()=>{if(session.current!==null)invoke('cancel_mission_deployment',{id:session.current}).catch(console.error);},0);
 };},[]);
 useEffect(()=>{
  if(!radio.connected||radio.connectionError||session.current!==null)return;
  const prepare=async()=>{
   if(!starting.current)starting.current=invoke('prepare_mission_deployment',{sequence:plan.sequence});
   const result=await starting.current;session.current=result.id;
   if(!mounted.current){await invoke('cancel_mission_deployment',{id:result.id});return;}
   setId(result.id);missionExperiment.bindDeployment(result.id);setError(null);await refreshLoRaConnection();
  };
  prepare().catch(reason=>{if(!mounted.current)return;if(isReceiverUnavailable(String(reason)))starting.current=null;else setError({stage:'prepare',message:String(reason)});});
 },[plan.sequence,radio.connected,radio.connectionError]);
 // Pressing Send Mission authorizes upload, never motion. No GPS/calibration or
 // firmware checkbox is used as evidence; onboard telemetry reports readiness.
 useEffect(()=>{
  if(phase!=='READY'||closing||acting.current||confirmRequested.current)return;acting.current=true;confirmRequested.current=true;
  invoke('confirm_mission_deployment',{id:session.current}).catch(reason=>setError({stage:'confirm',message:String(reason)})).finally(()=>{acting.current=false;setActionRevision(v=>v+1);});
 },[phase,id,closing,actionRevision]);
 useEffect(()=>{if(closing&&phase==='CANCELLED')onClose();},[closing,phase,onClose]);
 const close=async()=>{
  if(!deployment||['COMPLETE','CANCELLED'].includes(phase)){onClose();return;}
  if(acting.current)return;acting.current=true;setClosing(true);
  try{await invoke('cancel_mission_deployment',{id:session.current});await refreshLoRaConnection();}
  catch(reason){setError({stage:'cancel',message:String(reason)});setClosing(false);}
  finally{acting.current=false;}
 };
 const retry=async()=>{
  if(acting.current)return;acting.current=true;confirmRequested.current=false;setError(null);
  try{await invoke('retry_mission_deployment',{id:session.current});await refreshLoRaConnection();}
  catch(reason){setError({stage:'retry',message:String(reason)});}
  finally{acting.current=false;setActionRevision(v=>v+1);}
 };
 const failure=getDeploymentFailure(deployment,error);
 return <div style={{position:'fixed',inset:0,zIndex:9000,background:'#07160fa6',display:'grid',placeItems:'center',padding:16}}>
  <section className="mission-deployment-dialog" role="dialog" aria-modal="true" aria-labelledby="deployment-title" style={{background:'white',padding:22,borderRadius:16,maxHeight:'90vh',overflow:'auto',width:'min(680px,100%)'}}>
   <h2 id="deployment-title">Sending waypoint mission</h2>
   <p>{plan.legs.length} ordered coordinate targets. The rover calculates and corrects movement onboard.</p>
   <p>Keep CH6 HOLD and CH5 DISARM while uploading. Set rover CH8 to RX. Desktop radio mode switches automatically. After desktop RX returns, set rover CH8 to TX to restore feedback.</p>
   <LoRaConnectionStatus connection={radio} failure={failure}/>
   <p role="status">{getDeploymentProgress(deployment,closing)}</p>
   <p>Transmitted: {deployment?.transmitted_attempts>0?'Observed':'Unconfirmed'} · Rover delivery: {deployment?.acknowledged?'ACK2 received':'Unconfirmed'} · Mega staging: {deployment?.status_history?.some(s=>s.state==='STAGED')?'Reported':'Unconfirmed'}</p>
   <MissionStatusReport deployment={deployment} connected={radio.connected}/>
   {failure&&<p role="alert">{failure.message||failure.detail||JSON.stringify(failure)}</p>}
   {phase==='FAILED'&&!deployment.acknowledged&&deployment.failure_code!=='ROVER_REJECTED'&&<button disabled={!radio.connected||radio.mode!=='RX'} onClick={retry}>Retry same mission</button>}
   <p>Upload never starts motion. Wait for reported navigation readiness, then authorize RC and deliberately transition HOLD to SEMI_AUTO. Missing GPS/heading or calibration holds the rover; it does not prevent coordinate delivery.</p>
   <button onClick={close}>{phase==='COMPLETE'?'Close':'Close / cancel unsent upload'}</button>
   {closing&&phase==='FAILED'&&<button onClick={onClose}>Close after RX recovery failure</button>}
   <p>Closing cannot recall an already delivered mission. Use physical RC HOLD/DISARM to stop movement.</p>
  </section>
 </div>;
}
