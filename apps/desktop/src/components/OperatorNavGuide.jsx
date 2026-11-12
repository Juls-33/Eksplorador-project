import React from 'react';
import { Navigation } from 'lucide-react';

// Intentional rollback to the original compact Field Map card. No Codex-style
// supervision card or automatic multi-pin navigation controls are rendered.
export default function OperatorNavGuide({ waypoints = [], onPlanMission, disabled = false }) {
  return (
    <section className="card" style={{ padding: 16 }} aria-label="Point to point movement">
      <h3 style={{ marginBottom: 6 }}>Semi-Autonomous Movement</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Select one destination pin, mark the rover's starting position, and align it manually. The rover moves straight for one short, supervised leg.
      </p>
      <button type="button" className="badge" disabled={disabled || !waypoints.length} onClick={onPlanMission}
        style={{ background: 'var(--primary-green)', color: 'white', padding: '10px 14px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <Navigation size={16} /> Plan Point A → B
      </button>
      {!waypoints.length && <p style={{ fontSize: '0.78rem' }}>Create or select a mission with pinned locations first.</p>}
    </section>
  );
}
