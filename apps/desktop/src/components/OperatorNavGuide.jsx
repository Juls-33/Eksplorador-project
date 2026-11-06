
import React, { useEffect, useState } from 'react';
import {
  Compass,
  Navigation,
  CheckCircle2,
  Send,
} from 'lucide-react';
import {
  calculateDistanceMeters,
  calculateBearing,
  degreesToCardinal,
} from '../utils/geo';
import { hasSafetyHold, MOVEMENT_PROFILE, planMovementLeg, TIMED_MOVEMENT_NOTICE, validPosition } from '../utils/supervisedMission';
import { serializeTimedLeg } from '../utils/timedMission';



export default function OperatorNavGuide({
  roverHeading = null,
  waypoints = [],
  currentWaypointIdx = 0,
  reachedWaypointIdxs = null,
  reachRadiusM = 5,
  onSendMission = null,
  missionDeploymentPending = false,
  receiverReady = false,
  supervision,
  active = false,
  freshGps = null,
  positionCandidate = null,
  selectingPosition = false,
  onUseGps,
  onSelectPosition,
  onAction,
  onCancel,
  onNextLeg,
}) {
  const [headingInput, setHeadingInput] = useState('');
  const [checks, setChecks] = useState({ heading: false, probe: false, stopped: false, finished: false, retracted: false, disarmed: false, stationary: false, safe: false });
  const [reportResolution, setReportResolution] = useState('');
  const [missionStatus, setMissionStatus] = useState('');
  const phase = supervision?.phase || 'PLANNING';
  useEffect(() => {
    setChecks({ heading: false, probe: false, stopped: false, finished: false, retracted: false, disarmed: false, stationary: false, safe: false });
    setReportResolution('');
    setHeadingInput('');
  }, [phase, currentWaypointIdx, supervision?.hold?.source, supervision?.hold?.reportedAt, supervision?.operatorReport?.confirmedPhysical]);

  const reachedSet = reachedWaypointIdxs ? new Set(reachedWaypointIdxs) : null;
  
  const activeTarget = waypoints[currentWaypointIdx];
  const navigationPosition = supervision?.start?.coords || positionCandidate?.coords || freshGps?.coords;
  const distanceToTarget = activeTarget && navigationPosition ? calculateDistanceMeters(navigationPosition, activeTarget) : null;
  const requiredBearing = activeTarget && navigationPosition ? calculateBearing(navigationPosition, activeTarget) : 0;
  const cardinal = degreesToCardinal(requiredBearing);
  const inRange = Boolean(activeTarget) && distanceToTarget !== null && distanceToTarget <= reachRadiusM;
  const plan = planMovementLeg({ start: supervision?.start, heading: supervision?.heading, target: activeTarget });
  let timedSequence = '';
  let timedError = plan.error;
  if (!timedError && plan.instructions?.length) {
    try { timedSequence = serializeTimedLeg(plan.instructions); }
    catch (error) { timedError = error.message; }
  }
  const movementSequenceText = phase === 'READY' && !plan.error
    ? plan.instructions.map(instruction => `${instruction.action}: ${instruction.durationS.toFixed(2)} s`).join(' · ') || 'Already at the confirmed coordinate; inspect arrival.'
    : phase === 'READY' ? plan.error : 'Confirm the starting position, heading and probe clearance to prepare one leg.';
  const controlsEnabled = active && !hasSafetyHold(supervision) && !['COMPLETE', 'CANCELLED'].includes(phase);
  const canUpload = controlsEnabled && phase === 'READY' && receiverReady && Boolean(timedSequence) && !timedError && !missionDeploymentPending && Boolean(onSendMission);
  const canReviewReport = active && phase === 'HELD' && Boolean(supervision?.operatorReport) && !supervision?.firmwareFault;
  const check = (key, label, recovery = false) => <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.78rem' }}>
    <input type="checkbox" checked={checks[key]} disabled={!(recovery ? canReviewReport : controlsEnabled)} onChange={event => setChecks(previous => ({ ...previous, [key]: event.target.checked }))} />{label}
  </label>;
  const button = (label, action, enabled = true, recovery = false) => <button className="badge" style={{ cursor: enabled ? 'pointer' : 'not-allowed', padding: '6px 8px' }} disabled={!(recovery ? canReviewReport : controlsEnabled) || !enabled} onClick={action}>{label}</button>;

  // Only the operator-confirmed heading is used for coordinate-derived turns.
  const turnOffset = (requiredBearing - (supervision?.heading ?? 0) + 540) % 360 - 180;
  const turnDirection = turnOffset > 5 ? `Turn Right ${Math.abs(turnOffset)}°` : turnOffset < -5 ? `Turn Left ${Math.abs(turnOffset)}°` : 'Aligned on Target';

  return (
    <div className="card" style={{ background: '#fff', border: '1px solid var(--card-border)' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Compass size={16} color="var(--primary-green)" />
          Operator RC Movement Guide
        </span>
        <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
          Heading telemetry: {roverHeading === null ? '--' : `${roverHeading}°`}
        </span>
      </div>

      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {waypoints.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            No waypoints set. Start a mission and pin targets on the map to generate traversal steps.
          </p>
        ) : (
          <>
            {/* Target Alignment & Distance in Meters Card */}
            {activeTarget ? (
              <div style={{
                background: 'var(--bg-main)',
                borderRadius: '8px',
                padding: '12px',
                border: '1px solid var(--card-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {/* Visual Compass Needle Indicator */}
                  <div style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    background: '#1F5132',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
                  }}>
                    <Navigation
                      size={24}
                      color="#fff"
                      style={{
                        transform: `rotate(${requiredBearing - 45}deg)`,
                        transition: 'transform 0.3s ease'
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      TARGET PIN #{currentWaypointIdx + 1}
                      {inRange && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '999px' }}>
                          IN RANGE ≤ {reachRadiusM} m
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-dark)' }}>
                      {distanceToTarget ?? '--'} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>meters</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: Math.abs(turnOffset) <= 5 ? 'var(--primary-green)' : '#d97706' }}>
                      {navigationPosition ? `Face: ${requiredBearing}° (${cardinal})` : 'Position not confirmed'}{supervision?.heading !== null && supervision?.heading !== undefined ? ` • ${turnDirection}` : ''}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div style={{ color: 'var(--primary-green)', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={16} /> All selected pins sampled; probe retraction confirmed.
              </div>
            )}

            {/* Why the target moved, or how it will */}
            {activeTarget ? (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Distance is advisory. Accept arrival visually, save a sample and confirm probe retraction before continuing.
              </div>
            ) : null}

            {/* Sequence List with Distances */}
            <div style={{ maxHeight: '110px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {waypoints.map((pt, idx) => {
                const isCurrent = idx === currentWaypointIdx;
                const isPassed = reachedSet ? reachedSet.has(idx) : idx < currentWaypointIdx;
                // With out-of-order progress, a later pin can be in range before the target is.
                const rowInRange = Boolean(navigationPosition) && !isPassed && calculateDistanceMeters(navigationPosition, pt) <= reachRadiusM;
                const segDist = navigationPosition ? calculateDistanceMeters(navigationPosition, pt) : '--';
                const segBearing = navigationPosition ? calculateBearing(navigationPosition, pt) : '--';

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      fontSize: '0.78rem',
                      background: isCurrent ? 'rgba(31, 81, 50, 0.08)' : '#fff',
                      border: isCurrent ? '1px solid var(--primary-green)' : '1px solid #f1f5f9',
                      opacity: isPassed ? 0.5 : 1
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: isPassed ? '#94a3b8' : isCurrent ? 'var(--primary-green)' : 'var(--earth-light)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        fontWeight: 700
                      }}>
                        {idx + 1}
                      </span>
                      <span>Pin {idx + 1}</span>
                      {rowInRange && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '0 5px', borderRadius: '999px' }}>
                          IN RANGE
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', fontWeight: 600 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Heading: {segBearing}°</span>
                      <span style={{ color: 'var(--primary-green)' }}>{segDist}m forward</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Generated Movement Sequence Preview */}
            <div
              style={{
                marginTop: '12px',
                padding: '10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '6px' }}>
                Generated Movement Sequence · local timing preview
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                <strong>Movement profile: {MOVEMENT_PROFILE.name}</strong>
                <div>Forward: ~{MOVEMENT_PROFILE.forwardMps} m/s · {MOVEMENT_PROFILE.leftDps === MOVEMENT_PROFILE.rightDps
                  ? `Left/right turn: ~${MOVEMENT_PROFILE.leftDps}°/s`
                  : `Left turn: ~${MOVEMENT_PROFILE.leftDps}°/s · Right turn: ~${MOVEMENT_PROFILE.rightDps}°/s`}</div>
                <div>Initial field-test estimates; physical accuracy is not guaranteed.</div>
              </div>

              <code
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  overflowWrap: 'anywhere',
                  color: 'var(--primary-green)',
                }}
              >
                {movementSequenceText || 'No movement commands generated'}
              </code>
            </div>
            {phase === 'READY' && !plan.error && plan.partial && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Partial leg only: duration limit reached. Stop, inspect and reconfirm position and heading before another leg.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.78rem' }}>
              <div role="status">Operator stage: {phase.replaceAll('_', ' ')}</div>
              {!active && <p>Select or launch an active mission to prepare a leg. Saved samples remain available below.</p>}
              {active && ['PLANNING', 'INSPECTION'].includes(phase) && <>
                {phase === 'PLANNING' && <label>Next sampling pin
                  <select aria-label="Next sampling pin" value={currentWaypointIdx} disabled={!controlsEnabled} onChange={event => onAction({ type: 'SELECT_PIN', index: Number(event.target.value), pinCount: waypoints.length })}>
                    {waypoints.map((point, index) => <option key={index} value={index} disabled={reachedSet?.has(index)}>Pin {index + 1}{reachedSet?.has(index) ? ' · completed' : ''}</option>)}
                  </select>
                </label>}
                <div>{phase === 'INSPECTION' ? 'Confirm the sampling location after stopping.' : 'Choose and confirm the rover starting position.'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {button('Use fresh GPS', onUseGps, Boolean(freshGps))}
                  {button(selectingPosition ? 'Cancel map selection' : 'Select position on map', onSelectPosition)}
                </div>
                {selectingPosition && <p role="status">Click the rover’s estimated position on the existing Field Map. This is not a GPS measurement.</p>}
                <div role="status">{positionCandidate ? positionCandidate.source + ': ' + positionCandidate.coords.map(value => value.toFixed(6)).join(', ') : 'No position selected.'}</div>
                {positionCandidate?.source === 'GPS_MEASURED' && !validPosition(positionCandidate) && <p role="status">Selected GPS position is stale. Choose fresh GPS or select a map estimate.</p>}
                {positionCandidate?.source === 'OPERATOR_ESTIMATED' && <p>Operator estimate only. A sample without fresh GPS is saved with empty measured coordinates; the estimate is retained only in this session.</p>}
              </>}
              {active && phase === 'PLANNING' && <>
                <label>Actual rover heading (degrees, 0–359.99)
                  <input aria-label="Actual rover heading" type="number" min="0" max="359.99" step="any" value={headingInput} disabled={!controlsEnabled} onChange={event => { setHeadingInput(event.target.value); setChecks(previous => ({ ...previous, heading: false })); }} style={{ width: '100%' }} />
                </label>
                {check('heading', 'I verified the actual rover heading. GPS course is not stationary orientation.')}
                {check('probe', 'I verified the probe is fully retracted and clear, and the path is safe.')}
                {button('Confirm start and heading', () => onAction({ type: 'CONFIRM_START', position: positionCandidate, heading: headingInput, probeClear: checks.probe }), checks.heading && checks.probe && validPosition(positionCandidate) && headingInput !== '' && Number(headingInput) >= 0 && Number(headingInput) < 360)}
              </>}
              <button disabled={!canUpload} onClick={async () => {
                if (!canUpload) return;
                setMissionStatus('');
                try { await onSendMission(); }
                catch (error) { setMissionStatus(error?.message || String(error)); }
              }} aria-busy={missionDeploymentPending} title={timedError || TIMED_MOVEMENT_NOTICE} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', borderRadius: 6, background: canUpload ? 'var(--primary-green)' : '#94a3b8', color: '#fff', fontWeight: 700, cursor: canUpload ? 'pointer' : 'not-allowed' }}>
                <Send size={16} /> Send Mission
              </button>
              <p>{TIMED_MOVEMENT_NOTICE}</p>
              {phase === 'READY' && timedSequence && <p>Next leg upload: <code>{timedSequence}</code> ({plan.totalS.toFixed(3)} s). {plan.partial ? 'Partial journey only; stop and plan/authorize a new leg after inspection.' : 'Inspect arrival before sampling or planning again.'}</p>}
              {phase === 'READY' && timedError && <p role="status">Upload unavailable: {timedError}</p>}
              {missionStatus && <p role="alert">{missionStatus}</p>}
              {phase === 'READY' && <>
                <p>Starting point: {supervision.start.source}. Heading confirmed: {supervision.heading}°. Instructions transmitted: No. Radio ACK: Unconfirmed. Powered movement authorized: No.</p>
                {check('probe', 'I verified the probe is fully retracted and the path is safe before manual RC driving.')}
                {button('Use manual RC repositioning', () => onAction({ type: 'MANUAL_TAKEOVER', probeClear: checks.probe }), checks.probe)}
                {check('stopped', 'I visually verified that the rover is stopped using physical RC HOLD/DISARM.')}
                {button('Inspect arrival without movement', () => onAction({ type: 'INSPECT', stopped: checks.stopped }), checks.stopped)}
                {button('Reconfirm start and heading', () => onAction({ type: 'REPLAN' }))}
              </>}
              {phase === 'MANUAL' && <>
                <p>Manual RC movement authorized by operator. Use the existing physical RC controls. Starting position and heading have been invalidated; reconfirm them before any corrected route.</p>
                {check('stopped', 'I used physical RC HOLD/DISARM and visually verified the rover has stopped.')}
                {button('Rover stopped — inspect arrival', () => onAction({ type: 'INSPECT', stopped: checks.stopped }), checks.stopped)}
              </>}
              {['UPLOADING', 'AWAITING_START'].includes(phase) && <p role="status">Instructions transmitted: {supervision.transmitted ? 'Yes' : 'Unconfirmed'}. ACK2 queued to Mega UART: {supervision.acknowledged ? 'Yes' : 'Unconfirmed'}. Physical start authorized by operator: No. Follow the existing deployment guide; upload alone cannot start this leg.</p>}
              {phase === 'EXECUTION_UNVERIFIED' && <>
                <p>Physical HOLD → SEMI_AUTO authorization recorded for one leg. Mega acceptance, execution and stopping remain operator unverified. Do not infer completion from elapsed time.</p>
                {check('stopped', 'I used physical RC HOLD/DISARM and visually verified the rover has stopped.')}
                {button('Rover stopped — inspect arrival', () => onAction({ type: 'INSPECT', stopped: checks.stopped }), checks.stopped)}
              </>}
              {['MANUAL', 'INSPECTION', 'EXECUTION_UNVERIFIED'].includes(phase) && <p role="status">Execution unverified — operator inspection required. A radio ACK or estimated timer never verifies movement completion.</p>}
              {phase === 'INSPECTION' && <>
                {check('stopped', 'I visually accept this sampling location and verified the rover is stopped. Acceptance may be outside 5 meters.')}
                {button('Accept arrival and sample', () => onAction({ type: 'ACCEPT_ARRIVAL', position: positionCandidate, stopped: checks.stopped }), checks.stopped && validPosition(positionCandidate) && positionCandidate.confirmedAt >= supervision.inspectionAt)}
                {button('Reject arrival — prepare corrected leg', () => onAction({ type: 'REPLAN' }))}
                {check('probe', 'The probe is fully retracted and the path is safe for manual RC repositioning.')}
                {button('Use manual RC repositioning', () => onAction({ type: 'MANUAL_TAKEOVER', probeClear: checks.probe }), checks.probe)}
              </>}
              {['SAMPLING', 'RETRACT'].includes(phase) && <>
                <p>Accepted sampling location: {supervision.arrival.source} ({supervision.arrival.coords.map(value => value.toFixed(6)).join(', ')}). Intended pin remains unchanged.</p>
                <p>Keep the wheels stopped. Use the existing RC actuator controls when safe: left stick RIGHT extends DOWN; LEFT retracts UP; neutral stops. IMU tilt protection remains in firmware.</p>
                <p role="status">{phase === 'SAMPLING' ? 'Start or resume Logging. Extend the probe manually and wait for a valid RS485 soil sample to be saved.' : 'Soil sample saved. Retract the probe manually and verify clearance.'}</p>
                {phase === 'RETRACT' && <>
                  {check('finished', 'Sampling is finished at this location.')}
                  {check('retracted', 'I visually verified the probe is fully retracted and clear.')}
                  {button('Confirm sampling finished and probe retracted', () => onAction({ type: 'CONFIRM_RETRACTED', finished: checks.finished, retracted: checks.retracted, pinCount: waypoints.length }), checks.finished && checks.retracted)}
                </>}
              </>}
              {phase === 'NEXT_LEG' && <>
                <p>Pin completed. The next leg needs separate authorization, a new position confirmation and an actual heading check.</p>
                {button('Authorize preparation of next leg', onNextLeg)}
              </>}
              {phase === 'COMPLETE' && <p>Mission sampling completed. Use Mark Finished to save the mission status.</p>}
              {phase === 'HELD' && <>
                <div role="alert">
                  <p>Hold source: {supervision.hold?.source === 'OPERATOR_REPORT' ? 'Operator report (local)' : supervision.hold?.source === 'FIRMWARE_CONFIRMED' ? 'Firmware-confirmed fault' : 'Workflow interruption'}</p>
                  <p>Hold trigger: {supervision.hold?.trigger || 'Unknown; inspect before preparing again.'}</p>
                  <p>Hold reason: {supervision.hold?.reason || 'Reason unavailable.'}</p>
                  <p>Use physical RC HOLD/DISARM and verify the rover is stopped.</p>
                </div>
                {supervision.firmwareFault && <p>Firmware fault {supervision.firmwareFault.faultId} requires a matching verified firmware clearance signal. Local report correction, cancellation and new missions cannot clear it.</p>}
                {canReviewReport && <details>
                  <summary>Review local safety report</summary>
                  <p>{supervision.operatorReport.confirmedPhysical ? 'The operator confirmed this physical condition is present. Resolve it physically before reviewing clearance.' : 'This report came from the report button; it has not been verified by firmware or confirmed as a physical condition.'}</p>
                  <p>{supervision.operatorReport.confirmedPhysical ? 'This confirmed condition remains active across cancellation and new missions until it is physically resolved.' : 'Unverified reports belong to this mission. Cancellation closes the local report. If the condition is physically present, confirm it below so it continues to block other missions until resolved.'}</p>
                  {!supervision.operatorReport.confirmedPhysical && button('Confirm reported physical condition is present', () => onAction({ type: 'CONFIRM_OPERATOR_HAZARD' }), true, true)}
                  <label>Report review result
                    <select aria-label="Report review result" value={reportResolution} onChange={event => setReportResolution(event.target.value)}>
                      <option value="">Select after inspecting the rover</option>
                      {!supervision.operatorReport.confirmedPhysical && <option value="ENTERED_IN_ERROR">Report was entered in error; no physical condition exists</option>}
                      <option value="PHYSICALLY_RESOLVED">Reported physical condition has been resolved</option>
                    </select>
                  </label>
                  {check('disarmed', 'I physically verified SA is DISARMED and SB is HOLD.', true)}
                  {check('stationary', 'I visually verified the rover is stationary.', true)}
                  {check('safe', 'I inspected the reported condition; it is absent or resolved and the surroundings are safe.', true)}
                  {check('probe', 'I verified the probe is fully retracted and clear.', true)}
                  {button('Apply local report review — return to planning', () => onAction({ type: 'REVIEW_OPERATOR_REPORT', resolution: reportResolution, disarmed: checks.disarmed, stationary: checks.stationary, safe: checks.safe, probeClear: checks.probe }), Boolean(reportResolution) && checks.disarmed && checks.stationary && checks.safe && checks.probe, true)}
                  <p>These are operator confirmations, not electronic switch verification. This only corrects the local report; position, heading and probe clearance must be reconfirmed before another leg. It does not authorize movement.</p>
                </details>}
                {!hasSafetyHold(supervision) && button('Prepare again after inspection', () => onAction({ type: 'REPLAN' }))}
              </>}
              {active && !['COMPLETE', 'CANCELLED', 'HELD'].includes(phase) && button('Report obstacle / RC loss / safety hold', () => onAction({ type: 'REPORT_OPERATOR_FAULT', reason: 'Operator reported an obstacle, RC loss or physical safety fault' }))}
              {active && phase !== 'CANCELLED' && <button className="badge" onClick={onCancel}>Cancel mission — use RC HOLD/DISARM</button>}
              <p>The desktop cannot stop the rover. Use physical RC HOLD/DISARM for intervention. No automatic actuator action or next leg is sent.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
