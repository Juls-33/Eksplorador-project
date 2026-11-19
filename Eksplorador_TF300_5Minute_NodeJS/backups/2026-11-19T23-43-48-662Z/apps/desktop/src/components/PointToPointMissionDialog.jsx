import React, { useEffect, useState } from 'react';
import { CheckCircle2, MapPin, Navigation, X } from 'lucide-react';
import { degreesToCardinal } from '../utils/geo';
import { FORWARD_MPS, MAX_LEG_S, freshFusionStart, makeStraightLeg } from '../utils/pointToPointMission.js';
// EKSPLORADOR_GPS_MISSION_FIX_V1

const buttonStyle = { cursor: 'pointer', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--card-border)' };
const format = point => point ? `${point[0].toFixed(6)}, ${point[1].toFixed(6)}` : 'Not selected';

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
  const gpsStatus = !gps ? 'No recent GPS received from the desktop receiver. Check the LoRa connection or select Point A on the map.'
    : !gpsStart ? 'No valid fresh GPS fix (5-second limit). Check satellite lock or use a manually selected map position.'
    : gpsStart.fixSource === 'fusion' ? 'Fresh validated FUS navigation GPS available.'
    : 'Fresh GPS from live DATA telemetry (' + gps.satsLocked + ' satellites). FUS unavailable; verify rover position before planning.';
  const start = origin === 'GPS' ? gpsStart : manualStart;
  const target = waypoints[pinIndex];
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
      // Revalidate GPS and complete plan at the actual moment of submission.
      await onSend(makeStraightLeg({ start, target, pinIndex, now: Date.now(), gps }));
    } catch (reason) { setError(reason.message || String(reason)); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  return <div style={{ position: 'fixed', inset: 0, zIndex: 8990, background: '#07160fa6', display: 'grid', placeItems: 'center', padding: 16 }}>
    <section className="mission-deployment-dialog" role="dialog" aria-modal="true" aria-labelledby="a33-title"
      style={{ background: 'white', borderRadius: 16, maxHeight: '90vh', overflow: 'auto', width: 'min(620px,100%)', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 id="a33-title" style={{ margin: 0 }}>Point A → Point B</h2>
        <button type="button" aria-label="Close planner" onClick={onClose} style={{ ...buttonStyle, background: 'white' }}><X size={16}/></button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>One destination, one forward movement. No automatic turning, waypoint sequence, or GPS-guided steering.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ fontWeight: 700 }}>1. Choose destination (Point B)
          <select aria-label="Destination pin" value={pinIndex} onChange={event => { onPinChange(Number(event.target.value)); setAligned(false); }}
            style={{ display: 'block', width: '100%', ...buttonStyle, marginTop: 6, background: 'white' }}>
            {waypoints.map((_, i) => <option key={i} value={i}>Pin {i + 1}</option>)}
          </select>
        </label>
        <div style={{ padding: 12, border: '1px solid var(--card-border)', borderRadius: 8 }}>
          <strong>2. Set rover starting position (Point A)</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <button type="button" style={{ ...buttonStyle, background: origin === 'GPS' ? '#e5f3e8' : 'white' }}
              onClick={() => { setOrigin('GPS'); setAligned(false); }} disabled={!gpsStart}>
              <Navigation size={14} /> {gpsStart ? 'Use live GPS' : 'GPS has no fresh fix'}
            </button>
            <button type="button" style={{ ...buttonStyle, background: origin === 'MANUAL' ? '#e5f3e8' : 'white' }}
              onClick={() => { setOrigin('MANUAL'); setAligned(false); if (!manualStart) onPickMap(); }}>
              {manualStart ? 'Use selected map position' : 'Choose Point A on map'}</button>
            <button type="button" style={{ ...buttonStyle, background: 'var(--primary-green)', color: 'white' }}
              onClick={() => { setOrigin('MANUAL'); setAligned(false); onPickMap(); }}><MapPin size={14}/> Select on map</button>
          </div>
          <p role="status" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 0 }}>{gpsStatus}</p>
          <p style={{ fontSize: '0.82rem', marginBottom: 0 }}>Source: <strong>{origin === 'GPS' ? (gpsStart?.fixSource === 'fusion' ? 'Validated FUS GPS fix' : 'Live rover GPS telemetry (not fused)') : 'Operator estimate (not GPS)'}</strong></p>
          <p style={{ fontSize: '0.82rem', marginBottom: 0 }}>Point A: {format(start?.coords)}</p>
          <p style={{ fontSize: '0.82rem', marginBottom: 0 }}>Point B: {format(target)}</p>
          {!start && <p role="status" style={{ color: '#a16207' }}>{origin === 'GPS' ? 'No fresh GPS. Select your rover position on the map instead.' : 'Select Point A directly on the field map.'}</p>}
        </div>
        <div style={{ padding: 12, border: '1px solid var(--card-border)', borderRadius: 8 }}>
          <strong>3. Point rover toward the destination</strong>
          {plan ? <>
            <p style={{ fontSize: '1.05rem', margin: '10px 0 4px' }}><strong>{plan.bearing.toFixed(0)}° {degreesToCardinal(plan.bearing)}</strong> from north · {plan.distanceM.toFixed(2)} m to Pin {plan.destinationPin}</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Physically turn the rover using MANUAL RC before uploading. GPS course is not the stationary rover's orientation.</p>
          </> : <p style={{ fontSize: '0.82rem' }}>Set Point A and B to calculate the direction.</p>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <input type="checkbox" checked={aligned} onChange={e => setAligned(e.target.checked)} /> I have manually pointed the rover toward Point B.
          </label>
        </div>
        <div style={{ padding: 12, border: '1px solid var(--card-border)', borderRadius: 8 }}>
          <strong>4. Review the movement</strong>
          {plan ? <>
            <p style={{ margin: '8px 0' }}>Forward command: <code>{plan.sequence}</code> · {plan.durationS.toFixed(3)} s · about {plan.estimatedLegM.toFixed(2)} m</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0' }}>Calculated from {plan.distanceM.toFixed(2)} m ÷ {FORWARD_MPS.toFixed(2)} m/s = {plan.estimatedTotalS.toFixed(3)} s. A single leg supports up to {MAX_LEG_S.toFixed(3)} s (about {(MAX_LEG_S * FORWARD_MPS).toFixed(2)} m). Longer legs are rejected, never shortened.</p>
            <p style={{ fontSize: '0.8rem', color: '#92400e', margin: '4px 0' }}>Speed is an estimate, not closed-loop ground-distance control. Supervise the rover and use the physical HOLD/DISARM controls if necessary.</p>
          </> : <p style={{ fontSize: '0.82rem' }}>{planningError || 'Awaiting valid starting position.'}</p>}
          <label style={{ display: 'flex', gap: 8, fontSize: '0.82rem' }}><input type="checkbox" checked={probeClear} onChange={e => setProbeClear(e.target.checked)} /> Soil probe is fully retracted and clear.</label>
          <label style={{ display: 'flex', gap: 8, fontSize: '0.82rem' }}><input type="checkbox" checked={pathClear} onChange={e => setPathClear(e.target.checked)} /> I can visually supervise the clear straight path.</label>
        </div>
        {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
        <button type="button" disabled={!canSend} onClick={send}
          style={{ ...buttonStyle, width: '100%', background: canSend ? 'var(--primary-green)' : '#9ca3af', color: '#fff', fontWeight: 700 }}>
          <CheckCircle2 size={16} /> {sending || busy ? 'Opening deployment guide…' : 'Continue to LoRa Upload Instructions'}
        </button>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Upload only stages the command. RC CH5/CH6/CH8 authorization is still needed; use physical HOLD/DISARM to stop. The estimated map position does not become a GPS fix or a soil measurement.</p>
      </div>
    </section>
  </div>;
}
