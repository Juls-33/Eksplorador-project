import React, { useState } from 'react';
import {
  Play,
  MapPin,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  AlertCircle
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import OperatorNavGuide from '../components/OperatorNavGuide';

const initialPlots = [
  'UST Field',
  'North Plot A',
  'South Plot B'
];

const initialMissions = [
  {
    id: 'MSN-001',
    name: 'North Soil Moisture Survey',
    location: 'North Plot A',
    date: '2026-08-20',
    status: 'Finished',
    waypoints: [
      [14.6095, 120.9890],
      [14.6098, 120.9894],
      [14.6102, 120.9899]
    ],
    summary: 'High moisture pockets detected near the northeast corner. Optimal for deep-root crop planting.',
    stats: { avgPh: 6.4, avgMoisture: '45%', avgEC: '1.2 dS/m', totalDistance: '124m', samplesCollected: 18 }
  },
  {
    id: 'MSN-002',
    name: 'South Nutrient & NPK Scan',
    location: 'South Plot B',
    date: '2026-08-22',
    status: 'Finished',
    waypoints: [
      [14.6080, 120.9875],
      [14.6084, 120.9879]
    ],
    summary: 'Low potassium levels observed across the central grid. Fertilizer supplementation advised.',
    stats: { avgPh: 5.9, avgMoisture: '38%', avgEC: '0.9 dS/m', totalDistance: '86m', samplesCollected: 12 }
  }
];

export default function FieldMapView() {
  const [plots, setPlots] = useState(initialPlots);
  const [missions, setMissions] = useState(initialMissions);
  const [selectedMissionId, setSelectedMissionId] = useState('MSN-001');
  const [activeMission, setActiveMission] = useState(null);

  // Live Rover Telemetry (GPS + IMU Heading)
  const [roverPos, setRoverPos] = useState([14.6095, 120.9895]);
  const [roverHeading, setRoverHeading] = useState(45);
  const [currentWaypointIdx, setCurrentWaypointIdx] = useState(0);

  // Modal & Waypoint Creation States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newMission, setNewMission] = useState({ name: '', location: 'UST Field', date: new Date().toISOString().slice(0, 10) });
  const [isAddingPins, setIsAddingPins] = useState(false);
  const [tempWaypoints, setTempWaypoints] = useState([]);
  const [notification, setNotification] = useState(null);

  // Plot CRUD inline state
  const [isManagingPlots, setIsManagingPlots] = useState(false);
  const [newPlotInput, setNewPlotInput] = useState('');
  const [editingPlotIndex, setEditingPlotIndex] = useState(null);
  const [editPlotInput, setEditPlotInput] = useState('');
  const [plotError, setPlotError] = useState(null);

  const currentSelected = missions.find(m => m.id === selectedMissionId) || missions[0];

  const groupedMissions = missions.reduce((acc, msn) => {
    acc[msn.location] = acc[msn.location] || [];
    acc[msn.location].push(msn);
    return acc;
  }, {});

  const isPlotUsed = (plotName) => missions.some(m => m.location === plotName);

  const handleAddPlot = () => {
    const trimmed = newPlotInput.trim();
    if (!trimmed) return;
    if (plots.includes(trimmed)) {
      setPlotError('Plot name already exists.');
      return;
    }
    setPlots(prev => [...prev, trimmed]);
    setNewMission(prev => ({ ...prev, location: trimmed }));
    setNewPlotInput('');
    setPlotError(null);
  };

  const handleStartEditPlot = (index) => {
    setEditingPlotIndex(index);
    setEditPlotInput(plots[index]);
    setPlotError(null);
  };

  const handleSaveEditPlot = (index) => {
    const trimmed = editPlotInput.trim();
    if (!trimmed) return;
    const oldName = plots[index];

    if (trimmed !== oldName && plots.includes(trimmed)) {
      setPlotError('A plot with this name already exists.');
      return;
    }

    setPlots(prev => prev.map((p, i) => (i === index ? trimmed : p)));
    setMissions(prev => prev.map(m => m.location === oldName ? { ...m, location: trimmed } : m));

    if (newMission.location === oldName) {
      setNewMission(prev => ({ ...prev, location: trimmed }));
    }

    setEditingPlotIndex(null);
    setEditPlotInput('');
    setPlotError(null);
  };

  const handleDeletePlot = (plotName) => {
    if (isPlotUsed(plotName)) {
      setPlotError(`Cannot delete "${plotName}" because it is linked to existing missions.`);
      return;
    }
    const updated = plots.filter(p => p !== plotName);
    setPlots(updated);
    if (newMission.location === plotName) {
      setNewMission(prev => ({ ...prev, location: updated[0] || '' }));
    }
    setPlotError(null);
  };

  const handleMapClick = (coords) => {
    if (isAddingPins) {
      setTempWaypoints(prev => [...prev, coords]);
    }
  };

  const handleStartMissionSetup = () => {
    if (!newMission.name.trim()) return;
    if (!newMission.location) {
      setPlotError('Please select or create a valid plot location.');
      return;
    }
    setIsModalOpen(false);
    setIsAddingPins(true);
    setTempWaypoints([]);
    setNotification({ type: 'info', message: 'Click on the map to place rover waypoint pins.' });
  };

  const handleLaunchMission = () => {
    if (tempWaypoints.length === 0) {
      setNotification({ type: 'error', message: 'Please add at least 1 waypoint on the map.' });
      return;
    }
    const missionObj = {
      id: `MSN-00${missions.length + 1}`,
      name: newMission.name,
      location: newMission.location,
      date: newMission.date,
      status: 'Active',
      waypoints: tempWaypoints,
      summary: 'Mission in progress. Collecting spatial telemetry...',
      stats: { avgPh: 6.2, avgMoisture: '41%', avgEC: '1.1 dS/m', totalDistance: '95m', samplesCollected: 4 }
    };

    setMissions(prev => [missionObj, ...prev]);
    setActiveMission(missionObj);
    setSelectedMissionId(missionObj.id);
    setCurrentWaypointIdx(0);
    setIsAddingPins(false);
    setNotification({ type: 'success', message: `Mission "${missionObj.name}" launched!` });
  };

  const handleFinishMission = (id) => {
    setMissions(prev => prev.map(m => m.id === id ? { ...m, status: 'Finished', summary: 'Mission successfully concluded. Telemetry logged to SQLite.' } : m));
    if (activeMission?.id === id) setActiveMission(null);
    setNotification({ type: 'success', message: `Mission has finished! Statistics and findings logged.` });
  };

  const handleAdvanceWaypoint = () => {
    const activePins = isAddingPins ? tempWaypoints : (currentSelected?.waypoints || []);
    if (currentWaypointIdx < activePins.length - 1) {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx(prev => prev + 1);
    } else {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx(activePins.length);
    }
  };

  const displayedWaypoints = isAddingPins ? tempWaypoints : (currentSelected?.waypoints || []);

  return (
    <div className="field-map-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Action & Mission Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Field Map & Mission Planning</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Plan rover GPS waypoints, monitor live tele-location, and analyze findings.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {isAddingPins ? (
            <>
              <button
                className="badge badge-connected"
                onClick={handleLaunchMission}
                style={{ cursor: 'pointer', padding: '8px 16px', background: 'var(--primary-green)', color: '#fff' }}
              >
                <Play size={16} /> Confirm & Launch ({tempWaypoints.length} Pins)
              </button>
              <button
                className="badge"
                onClick={() => { setIsAddingPins(false); setTempWaypoints([]); }}
                style={{ cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="badge"
              style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', padding: '8px 16px' }}
              onClick={() => {
                setIsModalOpen(true);
                setIsManagingPlots(false);
                setPlotError(null);
              }}
            >
              <Plus size={16} /> Start New Mission
            </button>
          )}
        </div>
      </div>

      {/* Alert / Notification Bar */}
      {notification && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: notification.type === 'success' ? '#dcfce7' : notification.type === 'error' ? '#fee2e2' : '#fef3c7',
          color: notification.type === 'success' ? '#166534' : notification.type === 'error' ? '#991b1b' : '#92400e',
          fontSize: '0.85rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{notification.message}</span>
          <X size={14} style={{ cursor: 'pointer' }} onClick={() => setNotification(null)} />
        </div>
      )}

      {/* Main 3-Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1.9fr 1.35fr', gap: '14px', flex: 1, minHeight: 0 }}>
        {/* Left Column: Mission Directory */}
        <div className="card" style={{ overflowY: 'auto' }}>
          <div className="card-header">
            <span className="card-title">Mission Directory</span>
          </div>
          <div style={{ padding: '12px' }}>
            {Object.entries(groupedMissions).map(([loc, list]) => (
              <div key={loc} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--earth-light)', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MapPin size={12} /> {loc}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {list.map(m => (
                    <div
                      key={m.id}
                      onClick={() => {
                        setSelectedMissionId(m.id);
                        setCurrentWaypointIdx(0);
                      }}
                      style={{
                        padding: '10px',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: selectedMissionId === m.id ? 'var(--primary-green)' : 'var(--card-border)',
                        background: selectedMissionId === m.id ? 'rgba(31, 81, 50, 0.05)' : '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <strong style={{ fontSize: '0.85rem' }}>{m.name}</strong>
                        <span style={{
                          fontSize: '0.68rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: m.status === 'Active' ? '#dcfce7' : '#f1f5f9',
                          color: m.status === 'Active' ? '#166534' : 'var(--text-muted)',
                          fontWeight: 700
                        }}>
                          {m.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                        <span>{m.id}</span>
                        <span>•</span>
                        <span>{m.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Center Column: Unobstructed Interactive Map */}
        <div className="card" style={{ position: 'relative' }}>
          <div className="card-header">
            <span className="card-title">
              {isAddingPins ? '📍 Pinning Waypoints (Click Map to Add)' : `Active Map View: ${currentSelected?.name || 'Live'}`}
            </span>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              GPS: {roverPos[0].toFixed(4)}° N, {roverPos[1].toFixed(4)}° E
            </div>
          </div>
          <HeatmapMap
            center={[14.6095, 120.9895]}
            zoom={18}
            waypoints={displayedWaypoints}
            roverPos={roverPos}
            onMapClick={handleMapClick}
            isSettingWaypoints={isAddingPins}
          />
        </div>

        {/* Right Column: Analytics, Crop Suitability & Operator Traversal Guide */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
          {/* Mission Overview */}
          <div className="card" style={{ flexShrink: 0 }}>
            <div className="card-header">
              <span className="card-title">Mission Overview: {currentSelected?.id}</span>
              {currentSelected?.status === 'Active' && (
                <button
                  onClick={() => handleFinishMission(currentSelected.id)}
                  style={{ background: 'var(--accent-gold)', border: 'none', padding: '4px 8px', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Mark Finished
                </button>
              )}
            </div>
            <div style={{ padding: '10px 12px', fontSize: '0.82rem' }}>
              <p style={{ color: 'var(--text-dark)', marginBottom: '8px' }}><strong>Summary:</strong> {currentSelected?.summary}</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg. Moisture</div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--primary-green)' }}>{currentSelected?.stats.avgMoisture}</div>
                </div>
                <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg. pH Level</div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--earth-light)' }}>{currentSelected?.stats.avgPh}</div>
                </div>
                <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg. Conductivity</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{currentSelected?.stats.avgEC}</div>
                </div>
                <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Distance Covered</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{currentSelected?.stats.totalDistance}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Crop Suitability Matrix */}
          <div className="card" style={{ flexShrink: 0 }}>
            <div className="card-header">
              <span className="card-title">Crop Suitability Matrix</span>
            </div>
            <div style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span>🌾 Rice / Paddy</span>
                <strong style={{ color: 'var(--primary-green)' }}>94% Highly Suitable</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span>🌽 Sweet Corn</span>
                <strong style={{ color: 'var(--primary-green)' }}>88% Suitable</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span>🥔 Cassava / Tuber</span>
                <strong style={{ color: 'var(--accent-gold)' }}>65% Moderate</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>🥬 Leafy Greens</span>
                <strong style={{ color: 'var(--earth-light)' }}>42% Low</strong>
              </div>
            </div>
          </div>

          {/* Operator Traversal Guidance Card */}
          <div style={{ flex: 1, minHeight: '190px' }}>
            <OperatorNavGuide
              roverPos={roverPos}
              roverHeading={roverHeading}
              waypoints={displayedWaypoints}
              currentWaypointIdx={currentWaypointIdx}
              onAdvanceWaypoint={handleAdvanceWaypoint}
            />
          </div>
        </div>
      </div>

      {/* Start Mission Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            padding: '24px',
            width: '460px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Create New Mission</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {plotError && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '6px',
                background: '#fee2e2',
                color: '#991b1b',
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <AlertCircle size={14} />
                <span>{plotError}</span>
              </div>
            )}

            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Mission Name</label>
              <input
                type="text"
                placeholder="e.g., East Boundary Nutrient Check"
                value={newMission.name}
                onChange={e => setNewMission({ ...newMission, name: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Plot Location</label>
                <button
                  type="button"
                  onClick={() => { setIsManagingPlots(!isManagingPlots); setPlotError(null); }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--primary-green)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {isManagingPlots ? 'Done Managing' : 'Manage Plots'}
                </button>
              </div>

              {!isManagingPlots ? (
                <select
                  value={newMission.location}
                  onChange={e => setNewMission({ ...newMission, location: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
                >
                  {plots.map(plot => (
                    <option key={plot} value={plot}>{plot}</option>
                  ))}
                </select>
              ) : (
                <div style={{
                  marginTop: '8px',
                  border: '1px solid var(--card-border)',
                  borderRadius: '8px',
                  padding: '10px',
                  background: 'var(--bg-main)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      placeholder="Add new plot..."
                      value={newPlotInput}
                      onChange={e => setNewPlotInput(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.8rem' }}
                    />
                    <button
                      type="button"
                      onClick={handleAddPlot}
                      style={{
                        background: 'var(--primary-green)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        cursor: 'pointer'
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {plots.map((plot, index) => {
                      const used = isPlotUsed(plot);
                      const isEditing = editingPlotIndex === index;

                      return (
                        <div
                          key={index}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            background: '#fff',
                            borderRadius: '4px',
                            border: '1px solid #e2e8f0',
                            fontSize: '0.8rem'
                          }}
                        >
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                              <input
                                type="text"
                                value={editPlotInput}
                                onChange={e => setEditPlotInput(e.target.value)}
                                style={{ flex: 1, padding: '2px 6px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--card-border)' }}
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveEditPlot(index)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary-green)' }}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPlotIndex(null)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span style={{ fontWeight: 500 }}>
                                {plot} {used && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>(in use)</span>}
                              </span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditPlot(index)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                                  title="Edit Plot Name"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePlot(plot)}
                                  disabled={used}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: used ? 'not-allowed' : 'pointer',
                                    color: used ? '#cbd5e1' : '#ef4444'
                                  }}
                                  title={used ? 'Cannot delete plot with existing missions' : 'Delete Plot'}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Scheduled Date</label>
              <input
                type="date"
                value={newMission.date}
                onChange={e => setNewMission({ ...newMission, date: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                className="badge"
                onClick={() => setIsModalOpen(false)}
                style={{ cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                className="badge"
                onClick={handleStartMissionSetup}
                style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer' }}
              >
                Next: Place Pins
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}