import React from 'react';
import { Compass, Navigation, ArrowUpRight, CheckCircle2, ChevronRight } from 'lucide-react';
import { calculateDistanceMeters, calculateBearing, degreesToCardinal } from '../utils/geo';

export default function OperatorNavGuide({
  roverPos,
  roverHeading = 0, // IMU Yaw / Heading from ESP32 / Arduino
  waypoints = [],
  currentWaypointIdx = 0,
  onAdvanceWaypoint = null
}) {
  const activeTarget = waypoints[currentWaypointIdx];
  const distanceToTarget = activeTarget ? calculateDistanceMeters(roverPos, activeTarget) : 0;
  const requiredBearing = activeTarget ? calculateBearing(roverPos, activeTarget) : 0;
  const cardinal = degreesToCardinal(requiredBearing);

  // Turn difference between IMU heading and target bearing (-180 to 180)
  let turnOffset = (requiredBearing - roverHeading + 540) % 360 - 180;
  const turnDirection = turnOffset > 5 ? `Turn Right ${Math.abs(turnOffset)}°` : turnOffset < -5 ? `Turn Left ${Math.abs(turnOffset)}°` : 'Aligned on Target';

  return (
    <div className="card" style={{ background: '#fff', border: '1px solid var(--card-border)' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Compass size={16} color="var(--primary-green)" />
          Operator RC Movement Guide
        </span>
        <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
          IMU Yaw: {roverHeading}°
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
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      TARGET PIN #{currentWaypointIdx + 1}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-dark)' }}>
                      {distanceToTarget} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>meters</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: Math.abs(turnOffset) <= 5 ? 'var(--primary-green)' : '#d97706' }}>
                      Face: {requiredBearing}° ({cardinal}) • {turnDirection}
                    </div>
                  </div>
                </div>

                {onAdvanceWaypoint && (
                  <button
                    onClick={onAdvanceWaypoint}
                    style={{
                      background: 'var(--primary-green)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>Reached</span>
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--primary-green)', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={16} /> All Waypoint Objectives Traversed!
              </div>
            )}

            {/* Sequence List with Distances */}
            <div style={{ maxHeight: '110px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {waypoints.map((pt, idx) => {
                const isCurrent = idx === currentWaypointIdx;
                const isPassed = idx < currentWaypointIdx;
                const segDist = idx === 0 ? calculateDistanceMeters(roverPos, pt) : calculateDistanceMeters(waypoints[idx - 1], pt);
                const segBearing = idx === 0 ? calculateBearing(roverPos, pt) : calculateBearing(waypoints[idx - 1], pt);

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
                    </div>

                    <div style={{ display: 'flex', gap: '10px', fontWeight: 600 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Heading: {segBearing}°</span>
                      <span style={{ color: 'var(--primary-green)' }}>{segDist}m forward</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}