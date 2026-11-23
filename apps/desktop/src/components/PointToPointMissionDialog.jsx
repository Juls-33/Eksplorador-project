import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Compass, MapPin, Navigation, X } from 'lucide-react';
import { degreesToCardinal } from '../utils/geo';
import { FORWARD_MPS, MAX_LEG_S, freshFusionStart, makeStraightLeg } from '../utils/pointToPointMission.js';
import { MAX_PLANNING_RADIUS_M, isWithinPlanningRadius, planningDistanceM } from '../utils/planningRadius.js';
import './PointToPointMissionDialog.css';
// EKSPLORADOR_GPS_MISSION_FIX_V1 — no rover protocol or final validation changes.

const format = point => point ? `${point[0].toFixed(6)}, ${point[1].toFixed(6)}` : 'Not selected';

function SafetyCheck({ checked, onChange, title, hint }) {
  return <label className={`a2b-check${checked ? ' a2b-check--checked' : ''}`}>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span className="a2b-check__copy"><strong>{title}</strong><small>{hint}</small></span>
    <CheckCircle2 className="a2b-check__done" size={20} aria-hidden="true" />
  </label>;
}

export default function PointToPointMissionDialog({ open, onClose, onPickMap, onSend, gps, manualStart,
  waypoints, pinIndex, onPinChange, initialOrigin = null, sending = false }) {
  const [origin, setOrigin] = useState('GPS');
  const [aligned, setAligned] = useState(false);
  const [probeClear, setProbeClear] = useState(false);
  const [pathClear, setPathClear] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setError(''); setBusy(false);
    setAligned(false); setProbeClear(false); setPathClear(false);
    // When GPS has no fix, prioritize a previously selected map position.
    setOrigin(initialOrigin === 'MANUAL' ? 'MANUAL' : freshFusionStart(gps) ? 'GPS' : 'MANUAL');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [open]);

  const gpsStart = freshFusionStart(gps, now);
  const target = waypoints[pinIndex];
  const gpsInRange = gpsStart && isWithinPlanningRadius(gpsStart.coords, target);
  const start = origin === 'GPS' ? gpsStart : manualStart;
  const startDistance = planningDistanceM(start?.coords, target);
  const startInRange = startDistance !== null && isWithinPlanningRadius(start?.coords, target);

  let plan = null, planningError = '';
  if (start && target) {
    try { plan = makeStraightLeg({ start, target, pinIndex, now, gps }); }
    catch (reason) { planningError = reason.message; }
  }
  const canSend = Boolean(plan) && aligned && probeClear && pathClear && !sending && !busy;
  const send = async () => {
    setError('');
    if (!canSend) return;
    setBusy(true);
    try {
      // Revalidate GPS and the complete timed plan at the moment of submission.
      await onSend(makeStraightLeg({ start, target, pinIndex, now: Date.now(), gps }));
    } catch (reason) { setError(reason.message || String(reason)); }
    finally { setBusy(false); }
  };
  if (!open) return null;

  const gpsNote = !gpsStart ? 'No fresh GPS fix — select Point A on the map.'
    : !gpsInRange ? `GPS is outside the ${MAX_PLANNING_RADIUS_M.toFixed(2)} m planning circle.`
    : 'Fresh GPS is within the planning circle.';
  const positionNote = origin === 'GPS' ? gpsNote
    : manualStart ? 'Map-selected Point A is an operator estimate, not GPS.'
    : `Choose Point A inside the ${MAX_PLANNING_RADIUS_M.toFixed(2)} m circle on the map.`;
  const planningStatus = !start ? 'Choose Point A to see the movement.'
    : !startInRange ? `Point A is outside the ${MAX_PLANNING_RADIUS_M.toFixed(2)} m circle — choose a closer position.`
    : planningError ? 'This starting point cannot generate a valid timed leg.' : '';
  return <div className="a2b-planner__backdrop">
    <section className="mission-deployment-dialog a2b-planner" role="dialog" aria-modal="true" aria-labelledby="a33-title">
      <header className="a2b-planner__header">
        <div><span className="a2b-planner__eyebrow">EKSPLORADOR · MISSION PLANNER</span>
          <h2 id="a33-title">Point A → Point B</h2>
          <p>One supervised forward movement toward a saved pin.</p>
        </div>
        <button type="button" className="a2b-planner__close" aria-label="Close planner" onClick={onClose}><X size={20}/></button>
      </header>

      <div className="a2b-planner__body">
        <section className="a2b-step" aria-labelledby="a2b-destination-title">
          <div className="a2b-step__title"><span className="a2b-step__number">1</span><h3 id="a2b-destination-title">Choose destination</h3></div>
          <label className="a2b-field-label" htmlFor="a2b-pin-select">Point B · Saved sampling pin</label>
          <select id="a2b-pin-select" aria-label="Destination pin" className="a2b-select"
            value={pinIndex} onChange={event => { onPinChange(Number(event.target.value)); setAligned(false); }}>
            {waypoints.map((_, i) => <option key={i} value={i}>Pin {i + 1}</option>)}
          </select>
        </section>

        <section className="a2b-step" aria-labelledby="a2b-origin-title">
          <div className="a2b-step__title"><span className="a2b-step__number">2</span><h3 id="a2b-origin-title">Set rover position</h3></div>
          <p className="a2b-step__hint">Point A must be within {MAX_PLANNING_RADIUS_M.toFixed(2)} m of Pin {pinIndex + 1}.</p>
          <div className="a2b-planner__source-actions">
            <button type="button" className={`a2b-choice${origin === 'GPS' ? ' a2b-choice--active' : ''}`}
              onClick={() => { setOrigin('GPS'); setAligned(false); }} disabled={!gpsStart || !gpsInRange}>
              <Navigation size={17}/> Use live GPS
            </button>
            <button type="button" className={`a2b-choice${origin === 'MANUAL' && manualStart ? ' a2b-choice--active' : ''}`}
              onClick={() => { setOrigin('MANUAL'); setAligned(false); if (!manualStart) onPickMap(); }}>
              <MapPin size={17}/> {manualStart ? 'Use selected point' : 'Choose on map'}
            </button>
            <button type="button" className="a2b-choice a2b-choice--primary"
              onClick={() => { setOrigin('MANUAL'); setAligned(false); onPickMap(); }}>
              <MapPin size={17}/> Select on map
            </button>
          </div>
          <div role="status" className={`a2b-position-status${origin === 'GPS' && gpsStart && !gpsInRange ? ' a2b-position-status--warn' : ''}`}>
            {positionNote}
          </div>
          {start && <div className={`a2b-position-summary${!startInRange ? ' a2b-position-summary--warn' : ''}`}>
            <span>{origin === 'GPS' ? 'Live GPS' : 'Map estimate · not GPS'}</span>
            <strong>{startDistance === null ? 'Distance unavailable' : `${startDistance.toFixed(2)} m to Pin ${pinIndex + 1}`}</strong>
            <span>{startInRange ? 'Within range' : 'Outside range'}</span>
          </div>}
          <details className="a2b-details"><summary>View coordinates and GPS source <ChevronDown size={14}/></summary>
            <p>Point A: {format(start?.coords)}</p><p>Point B: {format(target)}</p>
            <p>Source: {origin === 'GPS' ? (gpsStart?.fixSource === 'fusion' ? 'Validated FUS GPS' : 'Satellite-confirmed DATA GPS') : 'Operator map estimate (not GPS)'}</p>
          </details>
        </section>

        <section className="a2b-step" aria-labelledby="a2b-direction-title">
          <div className="a2b-step__title"><span className="a2b-step__number">3</span><h3 id="a2b-direction-title">Align the rover</h3></div>
          {plan ? <div className="a2b-direction"><Compass size={21}/>
            <strong>{plan.bearing.toFixed(0)}° {degreesToCardinal(plan.bearing)}</strong>
            <span>{plan.distanceM.toFixed(2)} m · Pin {plan.destinationPin}</span></div>
            : <p role="status" className="a2b-step__hint">{planningStatus || 'Set a valid starting position.'}</p>}
          <SafetyCheck checked={aligned} onChange={setAligned} title="Rover aligned" hint="I pointed the rover at Point B using manual RC." />
        </section>

        <section className="a2b-step" aria-labelledby="a2b-review-title">
          <div className="a2b-step__title"><span className="a2b-step__number">4</span><h3 id="a2b-review-title">Safety check</h3></div>
          {plan ? <>
            <div className="a2b-timed-summary"><span>Forward command</span><strong><code>{plan.sequence}</code></strong><span>{plan.durationS.toFixed(3)} s · ~{plan.estimatedLegM.toFixed(2)} m</span></div>
            {plan.durationS > 60 && <div role="alert" className="a2b-warning"><AlertTriangle size={18}/>
              <span>Long movement: bench sonar is not suitable for field travel; verify obstacle protection before proceeding.</span></div>}
            <div className="a2b-caution"><AlertTriangle size={16}/><span>Timed estimate only — supervise the route and use physical HOLD/DISARM to stop.</span></div>
          </> : <p role="status" className="a2b-step__hint">{planningStatus || 'Awaiting a valid starting position.'}</p>}
          <div className="a2b-checklist">
            <SafetyCheck checked={probeClear} onChange={setProbeClear} title="Probe retracted" hint="The soil probe is fully clear of the ground." />
            <SafetyCheck checked={pathClear} onChange={setPathClear} title="Path clear" hint="I can visually supervise the straight route." />
          </div>
          <details className="a2b-details a2b-details--safety"><summary>Movement limitations and calculation <ChevronDown size={14}/></summary>
            <p>No automatic steering, turning, waypoint tracking, or arrival confirmation.</p>
            {plan && <p>{plan.distanceM.toFixed(2)} m ÷ {FORWARD_MPS.toFixed(3)} m/s = {plan.estimatedTotalS.toFixed(3)} s; maximum {MAX_LEG_S.toFixed(3)} s (~{MAX_PLANNING_RADIUS_M.toFixed(2)} m).</p>}
            <p>Movement speed and map position are estimates, not closed-loop ground-distance control; monitor obstacle clearance and use physical HOLD/DISARM if necessary.</p>
            <p>Upload stages a command only; physical CH5/CH6/CH8 authorization remains required.</p>
          </details>
        </section>
      </div>
      <footer className="a2b-planner__footer">
        {error && <p role="alert" className="a2b-planner__error">{error}</p>}
        <button type="button" className="a2b-planner__continue" disabled={!canSend} onClick={send}>
          <CheckCircle2 size={17}/> {sending || busy ? 'Opening deployment guide…' : 'Continue to LoRa Upload Instructions'}
        </button>
        <small>Confirm all three safety checks before proceeding.</small>
      </footer>
    </section>
  </div>;
}
