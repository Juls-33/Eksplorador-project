import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, X } from 'lucide-react';
import { refreshLoRaConnection, useLoRaConnection } from '../hooks/useLoRaConnection';
import { getDeploymentFailure, getDeploymentProgress, isReceiverUnavailable } from '../utils/loraStatus';
import LoRaConnectionStatus from './LoRaConnectionStatus';
import controllerGuide from '../assets/radiomaster-pocket-guide.png';
import './MissionDeploymentWizard.css';

const terminal = phase => ['COMPLETE', 'FAILED', 'CANCELLED'].includes(phase);

export default function MissionDeploymentWizard({ sequence, onClose }) {
  const radio = useLoRaConnection();
  const [sessionId, setSessionId] = useState(null);
  const deployment = radio.deployment?.id === sessionId ? radio.deployment : null;
  const [checks, setChecks] = useState({hold:false,disarm:false,rx:false});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const session = useRef(null);
  const starting = useRef(null);
  const actionPending = useRef(false);
  const cleanupTimer = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    clearTimeout(cleanupTimer.current);
    return () => {
      mounted.current = false;
      // Defer one task so StrictMode's immediate re-setup can retain the session.
      cleanupTimer.current = setTimeout(() => {
        if (session.current !== null) invoke('cancel_mission_deployment', {id:session.current}).catch(console.error);
      }, 0);
    };
  }, [sequence]);

  useEffect(() => {
    // A receiver that has not been discovered is a waiting condition, not an
    // error. Begin the existing preparation workflow once USB is confirmed.
    if (!radio.connected || radio.connectionError || session.current !== null) return;
    const prepare = async () => {
      if (!starting.current) starting.current = invoke('prepare_mission_deployment', {sequence});
      const started = await starting.current;
      session.current = started.id;
      if (!mounted.current) {
        await invoke('cancel_mission_deployment', {id:started.id});
        return;
      }
      setSessionId(started.id);
      setError(null);
      await refreshLoRaConnection();
    };
    prepare().catch(reason => {
      if (!mounted.current) return;
      const message = String(reason);
      if (isReceiverUnavailable(message)) {
        starting.current = null; // Allow preparation after a real reconnection.
      } else {
        setError({stage:'prepare', message});
      }
    });
  }, [sequence, radio.connected, radio.connectionError]);

  useEffect(() => {
    if (closing && deployment?.phase === 'CANCELLED') onClose();
  }, [closing, deployment?.phase, onClose]);

  const close = async () => {
    if (actionPending.current) return;
    if (!deployment || ['COMPLETE','CANCELLED'].includes(deployment.phase) || (closing && deployment.phase === 'FAILED')) { onClose(); return; }
    actionPending.current = true;
    setClosing(true);
    setError(null);
    try {
      await invoke('cancel_mission_deployment', {id:session.current});
      // Keep dialog visible until RX recovery completes or reports failure.
    } catch (reason) { setClosing(false); setError({stage:'cancel', message:String(reason)}); }
    finally { actionPending.current = false; }
  };
  const confirm = async () => {
    if (actionPending.current || closing || deployment?.phase !== 'READY' || !Object.values(checks).every(Boolean)) return;
    actionPending.current = true;
    setPending(true);
    setError(null);
    try { await invoke('confirm_mission_deployment', {id:session.current}); }
    catch (reason) { setError({stage:'confirm', message:String(reason)}); }
    finally { actionPending.current = false; setPending(false); }
  };

  const retry = async () => {
    if (actionPending.current || closing || deployment?.phase !== 'FAILED') return;
    actionPending.current = true;
    setPending(true);
    setError(null);
    setChecks({hold:false,disarm:false,rx:false});
    try { await invoke('retry_mission_deployment', {id:session.current}); }
    catch (reason) { setError({stage:'retry', message:String(reason)}); }
    finally { actionPending.current = false; setPending(false); }
  };

  const phase = deployment?.phase;
  const ready = radio.connected && !radio.connectionError && phase === 'READY' && !closing;
  const canConfirm = ready && Object.values(checks).every(Boolean) && !pending;
  const canStart = radio.connected && !radio.connectionError && radio.mode === 'RX' && phase === 'COMPLETE' && deployment.telemetry_seen;
  const failure = getDeploymentFailure(deployment, error);
  const workflowStatus = getDeploymentProgress(deployment, closing);
  const operationActive = deployment && !terminal(phase) && phase !== 'READY';
  const canRetry = radio.connected && !radio.connectionError && radio.mode === 'RX' && phase === 'FAILED'
    && !deployment.acknowledged && deployment.failure_code !== 'ROVER_REJECTED' && !pending && !closing;
  return (
    <div role="presentation" style={{position:'fixed',inset:0,zIndex:9000,background:'rgba(7,22,15,.65)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <section className="mission-deployment-dialog" role="dialog" aria-modal="true" aria-labelledby="deployment-title" style={{background:'white',color:'#14251b',borderRadius:16,boxShadow:'0 20px 70px #0005'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <h2 id="deployment-title" style={{fontSize:20,margin:0}}>Mission Deployment Assistant</h2>
          <button onClick={close} disabled={closing && !terminal(phase)} aria-label="Close deployment guide" style={{border:0,background:'none',cursor:'pointer'}}><X size={22}/></button>
        </div>
        <div className="mission-deployment-connection"><LoRaConnectionStatus connection={radio} failure={failure}/></div>
        {pill('Mission payload', <code style={{overflowWrap:'anywhere',whiteSpace:'normal'}}>{sequence}</code>)}
        {workflowStatus && <p className={`mission-deployment-progress${operationActive ? ' mission-deployment-progress--active' : ''}`} role="status" aria-live="polite">{workflowStatus}</p>}
        {deployment?.attempt > 0 && <div className="mission-delivery-evidence" aria-label="Mission communication evidence">
          <span>Local packet: {deployment.packet_submitted ? 'Submitted' : 'Pending'}</span>
          <span>Ground station: {deployment.ground_submitted ? 'Accepted' : 'Unconfirmed'}</span>
          <span>Current radio packet: {deployment.radio_transmitted ? 'Transmitted' : 'Unconfirmed'}</span>
          <span>Rover ESP32: {deployment.acknowledged ? 'Acknowledged' : 'Unconfirmed'}</span>
          <span>Mega storage: Unverified</span>
          <span>Mission execution: Not verified by desktop</span>
        </div>}
        {(!deployment || ['PREPARING','SWITCH_TX','READY'].includes(phase)) && <>
          <h3 className="mission-deployment-step-title">Prepare the rover safely</h3>
          <div className="mission-controller-step">
            <ControllerReference />
            <div>
              <fieldset className="mission-preparation-checklist" aria-describedby="mission-switch-confirmation-note">
                <legend>Operator preparation checklist</legend>
                {[
                  ['hold', 'Set SB (CH6) to HOLD.', 'Confirm the motors are stopped.'],
                  ['disarm', 'Set SA (CH5) to DISARM.', 'Disarm before uploading; secure the rover during bench testing.'],
                  ['rx', 'Set SD (CH8) to RX.', 'Set rover LoRa to receive the mission.'],
                ].map(([key,title,body]) => <label key={key} className="mission-preparation-item">
                  <input type="checkbox" checked={checks[key]} disabled={closing || pending || !['PREPARING','SWITCH_TX','READY'].includes(phase)} onChange={event => setChecks(previous => ({...previous,[key]:event.target.checked}))}/>
                  <span><strong>{title}</strong><span className="mission-controller-detail">{body}</span></span>
                </label>)}
              </fieldset>
              <p id="mission-switch-confirmation-note" className="mission-controller-note">Operator confirmations only; RC switch positions are not electronically verified.</p>
              <p className="mission-controller-detail">Desktop TX is prepared automatically. The mission is sent only after all three checks and your confirmation.</p>
              <button disabled={!canConfirm} onClick={confirm} style={primary(!canConfirm)}>Confirm rover ready · Send mission</button>
            </div>
          </div>
        </>}
        {deployment?.acknowledged && pill('Rover radio ACK confirmed', 'The rover ESP32 acknowledged this mission ID and payload checksum. Duplicate retries are not forwarded again. Mega storage and execution are not independently verified.')}
        {['TRANSMITTING','WAIT_ACK','RETRYING','ACKNOWLEDGED','SWITCH_RX'].includes(phase) && <p className="mission-controller-detail">Keep SD (CH8) = RX, SA (CH5) = DISARM, and SB (CH6) = HOLD during upload. {deployment?.error ? 'The app is recovering desktop RX.' : 'The desktop stays in upload mode throughout the retry sequence.'}</p>}
        {(phase === 'RESTORE' || canStart) && <>
          <h3 style={{fontSize:16,marginTop:16}}>Restore telemetry and start when safe</h3>
          <div className="mission-controller-step">
            <ControllerReference />
            <div>
              {pill('1 · Set SD (CH8) to TX.', 'Desktop RX is confirmed. Set the rover radio to TX to resume telemetry.')}
              {pill('2 · Verify telemetry has resumed.', canStart
                ? <><CheckCircle2 size={16} style={{verticalAlign:'middle'}}/> Backend received a fresh rover telemetry packet after desktop RX restoration.</>
                : <span role="status">Waiting for a fresh rover telemetry packet. Keep SB (CH6) in HOLD and SA (CH5) DISARM.</span>)}
              {canStart && <>
                {pill('3 · Set SA (CH5) to ARM.', 'When the rover is safe to start, arm it while keeping SB (CH6) in HOLD.')}
                {pill('4 · Set SB (CH6) to SEMI_AUTO.', 'Select SEMI_AUTO deliberately and verify rover behavior. The radio ACK does not confirm Mega mission storage.')}
                <button onClick={close} style={primary(false)}>Close guide</button>
              </>}
              <p className="mission-controller-note">Controller switch positions remain operator-confirmed. Only radio mode, mission ACK, and telemetry use backend evidence.</p>
            </div>
          </div>
        </>}
        {deployment?.retry_exhausted && <div className="mission-recovery-card">
          <strong>Check the rover before retrying</strong>
          <p>Confirm SD (CH8) = RX, SA (CH5) = DISARM, and SB (CH6) = HOLD.</p>
          <p>Possible causes — these have not been diagnosed:</p>
          <ul>
            <li>Rover LoRa is still in TX mode.</li>
            <li>Rover is outside reliable communication range.</li>
            <li>Rover or LoRa module is unpowered.</li>
            <li>Radio configuration or antenna problem.</li>
            <li>Interference or packet loss.</li>
          </ul>
        </div>}
        {phase === 'FAILED' && <>
          <p className="mission-controller-detail">Do not arm. An unacknowledged upload may already have reached the rover. Retry Mission keeps the same ID and requires all safety checks again.</p>
          {!deployment.acknowledged && deployment.failure_code !== 'ROVER_REJECTED' && <button disabled={!canRetry} onClick={retry} style={primary(!canRetry)}>Retry Mission — reconfirm safety</button>}
        </>}
        {deployment && phase !== 'COMPLETE' && !closing && <button onClick={close} className="mission-deployment-cancel" disabled={pending}>Cancel</button>}
        {closing && phase === 'FAILED' && <button onClick={close} style={primary(false)}>Close guide after failure</button>}
        <div style={{marginTop:18,borderTop:'1px solid #e2e8f0',paddingTop:10,fontSize:12,color:'#64748b'}}>
          <strong>Communication details</strong>
          {deployment && <div>Mission ID/checksum: <code>{deployment.mission_key}</code></div>}
          <div style={{maxHeight:110,overflow:'auto',fontFamily:'monospace',overflowWrap:'anywhere'}}>{deployment?.evidence?.length ? deployment.evidence.map((line,index) => <div key={index}>{line}</div>) : 'No radio events observed yet.'}</div>
          <p>Closing cancels unsent work and restores RX. A packet already sent over radio cannot be recalled.</p>
        </div>
      </section>
    </div>
  );
}
function ControllerReference() {
  return (
    <figure className="mission-controller-reference">
      <img src={controllerGuide} alt="RadioMaster Pocket controller reference identifying SA for arm/disarm, SB for the three-position driving mode, and SD for rover LoRa RX/TX." />
      <figcaption>
        <strong>RadioMaster Pocket Hall Gimbal</strong>
        <span>Configured controls: SA → CH5 · SB → CH6 · SD → CH8</span>
        <span>SB positions: MANUAL / HOLD / SEMI_AUTO</span>
      </figcaption>
    </figure>
  );
}
function pill(title, body) { return <div style={{padding:'12px 14px',background:'#f4f7f5',border:'1px solid #dae5de',borderRadius:10,marginTop:9}}><strong>{title}</strong><div style={{fontSize:13,color:'#526157',marginTop:4}}>{body}</div></div>; }
function primary(disabled) { return {marginTop:14,padding:'11px 15px',background:disabled?'#94a3b8':'var(--primary-green)',color:'#fff',border:0,borderRadius:8,fontWeight:700,cursor:disabled?'not-allowed':'pointer',width:'100%'}; }
