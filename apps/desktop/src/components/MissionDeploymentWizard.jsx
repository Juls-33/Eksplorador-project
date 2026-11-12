import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, RadioTower, X } from 'lucide-react';
import { refreshLoRaConnection, useLoRaConnection } from '../hooks/useLoRaConnection';
import { missionExperiment } from '../hooks/useMissionExperiment';
import { getDeploymentFailure, getDeploymentProgress, isReceiverUnavailable } from '../utils/loraStatus';
import LoRaConnectionStatus from './LoRaConnectionStatus';
import MissionStatusReport from './MissionStatusReport';
import controllerGuide from '../assets/radiomaster-pocket-guide.png';
import './MissionDeploymentWizard.css';

const initialPrepareChecks = { hold: false, disarm: false, receive: false };
const initialStartChecks = { restoreTx: false, neutral: false, armedHold: false, semiAuto: false };
const allChecked = checks => Object.values(checks).every(Boolean);
const isUploadPhase = phase => !phase || ['PREPARING', 'SWITCH_TX', 'READY'].includes(phase);
const isTransportPhase = phase => ['TRANSMITTING', 'WAIT_ACK', 'RETRYING', 'ACKNOWLEDGED', 'SWITCH_RX'].includes(phase);

function ControllerReference() {
  return (
    <figure className="mission-controller-reference">
      <img src={controllerGuide} alt="RadioMaster Pocket controller reference showing SA on CH5 for arm and disarm, SB on CH6 for manual, hold and semi-auto, and SD on CH8 for rover LoRa receive and transmit." />
      <figcaption>
        <strong>RadioMaster Pocket · switch reference</strong>
        <span><b>SA · CH5</b> Arm / Disarm</span>
        <span><b>SB · CH6</b> Manual / Hold / Semi-auto</span>
        <span><b>SD · CH8</b> Rover LoRa RX / TX</span>
        <span>Use your actual RC configuration to verify the switch positions; the desktop cannot read them directly.</span>
      </figcaption>
    </figure>
  );
}

function ChecklistItem({ checked, onChange, disabled, title, detail }) {
  return (
    <label className={`mission-preparation-item${checked ? ' mission-preparation-item--done' : ''}`}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} />
      <span><strong>{title}</strong>{detail && <span className="mission-controller-detail">{detail}</span>}</span>
    </label>
  );
}

export default function MissionDeploymentWizard({ plan, onClose }) {
  const radio = useLoRaConnection();
  const session = useRef(null);
  const starting = useRef(null);
  const mounted = useRef(false);
  const cleanup = useRef(null);
  const acting = useRef(false);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState(false);
  const [prepareChecks, setPrepareChecks] = useState(initialPrepareChecks);
  const [startChecks, setStartChecks] = useState(initialStartChecks);

  const deployment = radio.deployment?.id === sessionId ? radio.deployment : null;
  const phase = deployment?.phase;
  const timed = plan.protocol === 'A31_TIMED';
  const failure = getDeploymentFailure(deployment, error);
  const progress = getDeploymentProgress(deployment, closing);
  const receiverReady = radio.connected && !radio.connectionError;
  const canUpload = receiverReady && phase === 'READY' && !closing && !pending && allChecked(prepareChecks);
  const canRetry = receiverReady && radio.mode === 'RX' && phase === 'FAILED' &&
    !deployment?.acknowledged && deployment?.failure_code !== 'ROVER_REJECTED' && !pending && !closing;
  const afterUpload = ['RESTORE', 'COMPLETE'].includes(phase);
  const telemetryReady = receiverReady && radio.mode === 'RX' && phase === 'COMPLETE' &&
    Boolean(deployment?.acknowledged && deployment?.rx_restored && deployment?.telemetry_seen);

  useEffect(() => {
    mounted.current = true;
    clearTimeout(cleanup.current);
    return () => {
      mounted.current = false;
      cleanup.current = setTimeout(() => {
        if (session.current !== null) invoke('cancel_mission_deployment', { id: session.current }).catch(console.error);
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!receiverReady || session.current !== null) return;
    const prepare = async () => {
      if (!starting.current) starting.current = invoke('prepare_mission_deployment', { sequence: plan.sequence });
      const result = await starting.current;
      session.current = result.id;
      if (!mounted.current) {
        await invoke('cancel_mission_deployment', { id: result.id });
        return;
      }
      setSessionId(result.id);
      if (plan.protocol === 'N1') missionExperiment.bindDeployment(result.id);
      setError(null);
      await refreshLoRaConnection();
    };
    prepare().catch(reason => {
      if (!mounted.current) return;
      if (isReceiverUnavailable(String(reason))) starting.current = null;
      else setError({ stage: 'prepare', message: String(reason) });
    });
  }, [plan.sequence, plan.protocol, radio.connected, radio.connectionError]);

  useEffect(() => {
    if (closing && phase === 'CANCELLED') onClose();
  }, [closing, phase, onClose]);

  const close = async () => {
    if (!deployment || ['COMPLETE', 'CANCELLED'].includes(phase) || (closing && phase === 'FAILED')) {
      onClose();
      return;
    }
    if (acting.current) return;
    acting.current = true;
    setClosing(true);
    setError(null);
    try {
      await invoke('cancel_mission_deployment', { id: session.current });
      await refreshLoRaConnection();
    } catch (reason) {
      setError({ stage: 'cancel', message: String(reason) });
      setClosing(false);
    } finally { acting.current = false; }
  };

  const confirm = async () => {
    if (!canUpload || acting.current) return;
    acting.current = true;
    setPending(true);
    setError(null);
    try {
      await invoke('confirm_mission_deployment', { id: session.current });
      await refreshLoRaConnection();
    } catch (reason) { setError({ stage: 'confirm', message: String(reason) }); }
    finally { acting.current = false; setPending(false); }
  };

  const retry = async () => {
    if (!canRetry || acting.current) return;
    acting.current = true;
    setPending(true);
    setError(null);
    setPrepareChecks(initialPrepareChecks);
    setStartChecks(initialStartChecks);
    try {
      await invoke('retry_mission_deployment', { id: session.current });
      await refreshLoRaConnection();
    } catch (reason) { setError({ stage: 'retry', message: String(reason) }); }
    finally { acting.current = false; setPending(false); }
  };

  const updatePrepare = (name, checked) => setPrepareChecks(prev => ({ ...prev, [name]: checked }));
  const updateStart = (name, checked) => setStartChecks(prev => ({
    ...prev, [name]: checked,
    ...(!checked && name === 'restoreTx' ? { neutral: false, armedHold: false, semiAuto: false } : {}),
    ...(!checked && name === 'neutral' ? { armedHold: false, semiAuto: false } : {}),
    ...(!checked && name === 'armedHold' ? { semiAuto: false } : {}),
  }));

  const uploadComplete = phase === 'COMPLETE';
  const showPrepare = isUploadPhase(phase);
  const showTransfer = isTransportPhase(phase);
  const showRecovery = phase === 'FAILED';
  const stage = showPrepare ? 1 : (showTransfer ? 2 : (afterUpload ? 3 : 0));

  return (
    <div className="mission-deployment-backdrop" role="presentation">
      <section className="mission-deployment-dialog" role="dialog" aria-modal="true" aria-labelledby="deployment-title">
        <div className="mission-deployment-header">
          <div>
            <span className="mission-deployment-eyebrow">EKSPLORADOR · MISSION ASSISTANT</span>
            <h2 id="deployment-title">{timed ? 'Deploy Point A → Point B' : 'Deploy waypoint mission'}</h2>
            <p>{timed
              ? `One supervised forward leg toward Pin ${plan.destinationPin}. No automatic turning or waypoint tracking.`
              : 'Prepare the rover, transfer the mission, then restore telemetry before starting.'}</p>
          </div>
          <button type="button" className="mission-deployment-icon-button" onClick={close} aria-label="Close deployment assistant" disabled={pending || (closing && phase !== 'FAILED')}><X size={19} /></button>
        </div>

        <div className="mission-deployment-steps" aria-label="Deployment stages">
          <span className={stage === 1 ? 'is-current' : stage > 1 ? 'is-done' : ''}>1 · Prepare RC</span>
          <span className={stage === 2 ? 'is-current' : stage > 2 ? 'is-done' : ''}>2 · Transfer</span>
          <span className={stage === 3 ? 'is-current' : ''}>3 · Restore &amp; start</span>
        </div>

        <div className="mission-deployment-connection"><LoRaConnectionStatus connection={radio} failure={failure} /></div>
        <div className="mission-deployment-payload">
          <span>{timed ? 'Forward-only mission' : 'Mission payload'}</span>
          <code>{plan.sequence}</code>
          {timed && <small>{plan.durationS.toFixed(3)} seconds · limited single leg</small>}
        </div>
        {progress && <p className={`mission-deployment-progress${showTransfer ? ' mission-deployment-progress--active' : ''}`} role="status" aria-live="polite">{progress}</p>}

        {showPrepare && (
          <>
            <h3 className="mission-deployment-step-title">Step 1 · Prepare the RadioMaster Pocket</h3>
            <p className="mission-deployment-intro">Use the controller diagram as your reference. Tick each switch only after checking the rover.</p>
            <div className="mission-controller-step">
              <ControllerReference />
              <div className="mission-controller-actions">
                <fieldset className="mission-preparation-checklist">
                  <legend>Before sending the mission</legend>
                  <ChecklistItem checked={prepareChecks.hold} onChange={value => updatePrepare('hold', value)} disabled={pending || closing}
                    title="SB (CH6) → HOLD" detail="Ensure the tracks are stopped. The rover should not move during upload." />
                  <ChecklistItem checked={prepareChecks.disarm} onChange={value => updatePrepare('disarm', value)} disabled={pending || closing}
                    title="SA (CH5) → DISARM" detail="Keep the rover disarmed while transferring the command." />
                  <ChecklistItem checked={prepareChecks.receive} onChange={value => updatePrepare('receive', value)} disabled={pending || closing}
                    title="SD (CH8) → RX" detail="Set the rover's LoRa module to receive this movement command." />
                </fieldset>
                <p className="mission-controller-note">These checkboxes record your confirmation; they do not measure the physical switch positions.</p>
                <button type="button" className="mission-deployment-primary" onClick={confirm} disabled={!canUpload}>
                  <RadioTower size={17} /> {pending ? 'Sending…' : 'Confirm switches · Send mission'}
                </button>
                {!receiverReady && <p className="mission-controller-detail">Connect the desktop LoRa USB receiver to enable upload.</p>}
                {receiverReady && phase !== 'READY' && <p className="mission-controller-detail">Waiting for the desktop LoRa to enter upload-ready mode.</p>}
                {receiverReady && phase === 'READY' && !allChecked(prepareChecks) && <p className="mission-controller-detail">Confirm all three RC switches to enable the send button.</p>}
              </div>
            </div>
          </>
        )}

        {showTransfer && (
          <div className="mission-deployment-transfer">
            <RadioTower size={25} aria-hidden="true" />
            <div>
              <h3>Transferring the movement command</h3>
              <p>Keep <strong>SA = DISARM</strong>, <strong>SB = HOLD</strong>, and <strong>SD = RX</strong> until the desktop restores its receiver mode.</p>
              <p>The rover's radio acknowledgment confirms delivery to its UART queue, not Mega acceptance or rover movement.</p>
            </div>
          </div>
        )}

        {afterUpload && (
          <>
            <h3 className="mission-deployment-step-title">Step 2 · Restore telemetry and authorize movement</h3>
            <p className="mission-deployment-intro">Follow the switch guide again. Uploading never starts the rover; movement needs deliberate physical RC authorization.</p>
            <div className="mission-controller-step">
              <ControllerReference />
              <div className="mission-controller-actions">
                <fieldset className="mission-preparation-checklist">
                  <legend>After the mission is uploaded</legend>
                  <ChecklistItem checked={startChecks.restoreTx} onChange={v => updateStart('restoreTx', v)}
                    title="1 · SD (CH8) → TX" detail="Restore rover telemetry after the desktop returns to RX." />
                  <div className={`mission-deployment-telemetry${telemetryReady ? ' is-ready' : ''}`} role="status">
                    {telemetryReady ? <><CheckCircle2 size={16} /> Desktop RX and fresh telemetry confirmed.</> : 'Waiting for fresh rover telemetry. Keep the rover disarmed and in HOLD.'}
                  </div>
                  <ChecklistItem checked={startChecks.neutral} onChange={v => updateStart('neutral', v)} disabled={!telemetryReady || !startChecks.restoreTx}
                    title="2 · Check the rover and surroundings" detail="Neutralize the sticks, retract the soil probe, and clear the straight path." />
                  <ChecklistItem checked={startChecks.armedHold} onChange={v => updateStart('armedHold', v)} disabled={!telemetryReady || !startChecks.neutral}
                    title="3 · SA (CH5) → ARM; SB stays HOLD" detail="Arm with neutral sticks. Ensure the rover has observed armed HOLD before proceeding." />
                  <ChecklistItem checked={startChecks.semiAuto} onChange={v => updateStart('semiAuto', v)} disabled={!telemetryReady || !startChecks.armedHold}
                    title="4 · SB (CH6) HOLD → SEMI_AUTO" detail="Authorize this one short forward leg while supervising the rover." />
                </fieldset>
                <p className="mission-controller-note">The desktop cannot verify these RC switch positions or physically stop the rover. Use CH6 HOLD / CH5 DISARM immediately if needed.</p>
                <button type="button" className="mission-deployment-primary" disabled={!telemetryReady || !allChecked(startChecks)} onClick={close}>
                  <CheckCircle2 size={17} /> Finish guide after operator checks
                </button>
              </div>
            </div>
            {timed && <p className="mission-deployment-caution"><strong>Arrival is not verified.</strong> This is a bounded timed leg, not GPS-guided travel to Pin {plan.destinationPin}. Observe the stop and select a new Point A before another leg.</p>}
          </>
        )}

        {showRecovery && (
          <div className="mission-recovery-card">
            <strong>Mission upload needs attention</strong>
            <p>Keep the rover in HOLD and DISARM. Check LoRa power, antenna and the SD (CH8) RX switch before retrying.</p>
            {deployment?.acknowledged && <p>An ACK may mean the command already reached the rover. Do not resend a new command or arm until the condition has been inspected.</p>}
            {canRetry && <button type="button" className="mission-deployment-primary" onClick={retry}>Retry same mission ID</button>}
          </div>
        )}

        <details className="mission-deployment-details">
          <summary>Communication details</summary>
          <div className="mission-delivery-evidence">
            <span>Radio transmitted: {deployment?.transmitted_attempts > 0 || deployment?.radio_transmitted ? 'Observed' : 'Unconfirmed'}</span>
            <span>Rover ACK2: {deployment?.acknowledged ? 'Received' : 'Unconfirmed'}</span>
            <span>Desktop RX restored: {deployment?.rx_restored ? 'Yes' : 'Unconfirmed'}</span>
            <span>Fresh telemetry: {deployment?.telemetry_seen ? 'Yes' : 'Unconfirmed'}</span>
            <span>Mega execution / physical arrival: Not verified by ACK2</span>
          </div>
          <MissionStatusReport deployment={deployment} connected={radio.connected} />
          {deployment?.mission_key && <p>Mission ID / checksum: <code>{deployment.mission_key}</code></p>}
          {deployment?.evidence?.length ? <div className="mission-deployment-evidence-log">{deployment.evidence.map((event, idx) => <div key={idx}>{event}</div>)}</div> : <p>No detailed radio events recorded yet.</p>}
        </details>

        <div className="mission-deployment-footer">
          <span>Closing cannot recall a command already received by the rover. Use physical HOLD / DISARM to stop motion.</span>
          <button type="button" className="mission-deployment-secondary" onClick={close} disabled={pending || (closing && phase !== 'FAILED')}>
            {uploadComplete ? 'Close' : 'Close / cancel upload'}
          </button>
        </div>
        {closing && phase === 'FAILED' && <button type="button" className="mission-deployment-secondary" onClick={onClose}>Close after recovery failure</button>}
      </section>
    </div>
  );
}
