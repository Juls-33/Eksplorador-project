import { useEffect, useRef, useState } from 'react';
import { resolveLastKnownGpsDisplay, validDisplayCoords } from '../utils/roverPositionDisplay.js';

const UNAVAILABLE = { position: null, mode: 'UNAVAILABLE', ageMs: null };

/**
 * Visual GPS-loss continuity only. This hook never changes roverPos, sensor-data,
 * planning GPS, soil geotags, mission controls, or persisted records.
 * The last fix is held for at most 30 s; no movement is extrapolated because
 * track advance / wheel circumference and initial yaw are not yet calibrated.
 */
export function useRoverDisplayPosition(liveGpsPosition, receiverConnected) {
  const lastFixRef = useRef(null);
  const [display, setDisplay] = useState(UNAVAILABLE);

  useEffect(() => {
    if (!receiverConnected) {
      lastFixRef.current = null;
      setDisplay(UNAVAILABLE);
      return;
    }
    if (validDisplayCoords(liveGpsPosition)) {
      const position = [...liveGpsPosition];
      lastFixRef.current = { position, receivedAt: Date.now() };
      setDisplay({ position, mode: 'GPS', ageMs: 0 });
      return;
    }
    setDisplay(resolveLastKnownGpsDisplay(lastFixRef.current, Date.now(), true));
  }, [liveGpsPosition, receiverConnected]);

  useEffect(() => {
    if (!receiverConnected || validDisplayCoords(liveGpsPosition)) return;
    const interval = setInterval(() => {
      const next = resolveLastKnownGpsDisplay(lastFixRef.current, Date.now(), true);
      if (next.mode === 'UNAVAILABLE') lastFixRef.current = null;
      setDisplay(next);
    }, 1000);
    return () => clearInterval(interval);
  }, [liveGpsPosition, receiverConnected]);

  return display;
}
