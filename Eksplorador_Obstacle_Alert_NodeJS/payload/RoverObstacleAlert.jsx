// EKSPLORADOR_OBSTACLE_ALERT_V1
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, X } from 'lucide-react';
import './RoverObstacleAlert.css';

// App-visible instructions, not commands. The receiver cannot control RC switches.
export default function RoverObstacleAlert() {
  const [alert, setAlert] = useState(null);
  const seenIds = useRef(new Set());

  useEffect(() => {
    let active = true;
    let stopListening = null;
    const show = payload => {
      if (!active || !payload || payload.reason !== 'SONAR' ||
          !Number.isInteger(payload.id) || payload.id <= 0 ||
          !Number.isInteger(payload.remaining_ms) || payload.remaining_ms < 0) return;
      if (seenIds.current.has(payload.id)) return;
      seenIds.current.add(payload.id);
      // Bound de-duplication memory. Repeats of the same frame cannot open many modals.
      if (seenIds.current.size > 64) {
        const oldest = seenIds.current.values().next().value;
        seenIds.current.delete(oldest);
      }
      setAlert(payload);
    };
    // Development-only simulation: DevTools console command listed in README.
    const showDemo = () => show({ id: Date.now() % 4000000000 + 1, remaining_ms: 31898, reason: 'SONAR', demo: true });
    if (import.meta.env.DEV) window.addEventListener('eksplorador-obstacle-demo', showDemo);
    listen('rover-obstacle', ({ payload }) => show(payload)).then(unlisten => {
      if (active) stopListening = unlisten;
      else unlisten();
    }).catch(error => console.error('[Obstacle Alert] listener unavailable', error));
    return () => {
      active = false;
      stopListening?.();
      if (import.meta.env.DEV) window.removeEventListener('eksplorador-obstacle-demo', showDemo);
    };
  }, []);

  if (!alert) return null;
  return (
    <div className="rover-obstacle-overlay">
      <section className="rover-obstacle-modal" role="alertdialog" aria-modal="true"
        aria-labelledby="rover-obstacle-title" aria-describedby="rover-obstacle-description">
        <header className="rover-obstacle-header">
          <AlertTriangle size={25} aria-hidden="true" />
          <h2 id="rover-obstacle-title">{alert.demo ? 'DEMO — ' : ''}Obstacle detected — manual intervention required</h2>
        </header>
        <p id="rover-obstacle-description">The rover reported an ultrasonic safety stop. The current timed movement was interrupted; it must not restart automatically when the obstacle disappears.</p>
        <p className="rover-obstacle-meta">Remaining at stop: {(alert.remaining_ms / 1000).toFixed(1)} seconds · Alert ID {alert.id}</p>
        <ol>
          <li>Inspect the area. Switch <strong>CH6 to MANUAL</strong> while supervising the rover.</li>
          <li>Use your RC controller to drive around the obstacle. MANUAL mode cancels the unfinished mission.</li>
          <li>Stop, DISARM, and re-plan from the rover's <strong>new actual position</strong>. Upload a fresh movement sequence using the normal mission assistant.</li>
        </ol>
        <p className="rover-obstacle-note">This popup is an alert only. Dismissing it does not arm, resume, or move the rover. If the radio link is unavailable, no desktop alert is guaranteed.</p>
        <button className="rover-obstacle-dismiss" type="button" autoFocus onClick={() => setAlert(null)}>
          <X size={16} aria-hidden="true" /> Acknowledge notification
        </button>
      </section>
    </div>
  );
}
