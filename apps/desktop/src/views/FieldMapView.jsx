import React, { useState } from 'react';
import {
  Play,
  MapPin,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  AlertCircle,
  Layers,
  Info
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import OperatorNavGuide from '../components/OperatorNavGuide';
import { isPointInPolygon, calculatePolygonArea } from '../utils/geo';

const initialPlots = [
  'UST Field',
  'North Plot A',
  'South Plot B'
];

const ustFieldBoundary = [
  [14.6097, 120.9888],
  [14.6105, 120.9901],
  [14.6090, 120.9912],
  [14.6082, 120.9898]
];

// Rich sample objects containing multi-variable sensor readings
const ustFieldSamples = [
  { coords: [14.6094, 120.9896], moisture: 46, ph: 6.5, n: 28, p: 38, k: 58, overall: 92 },
  { coords: [14.6096, 120.9899], moisture: 42, ph: 6.4, n: 24, p: 35, k: 52, overall: 88 },
  { coords: [14.6091, 120.9902], moisture: 38, ph: 6.1, n: 20, p: 30, k: 45, overall: 75 },
  { coords: [14.6088, 120.9898], moisture: 34, ph: 5.8, n: 16, p: 25, k: 38, overall: 60 },
  { coords: [14.6098, 120.9894], moisture: 48, ph: 6.8, n: 32, p: 44, k: 64, overall: 95 },
  { coords: [14.6085, 120.9905], moisture: 28, ph: 5.5, n: 12, p: 20, k: 30, overall: 45 }
];

// Color Legends and Gradients for each selected layer
const layerConfigurations = {
  overall: {
    label: 'Overall Soil Health',
    unit: 'Score / 100',
    gradient: {
      0.2: '#dc2626', // Red: Critical / Degraded
      0.4: '#ea580c', // Orange: Low Fertility
      0.6: '#eab308', // Yellow: Moderate
      0.8: '#84cc16', // Light Green: Good
      1.0: '#15803d'  // Dark Green: Optimal
    },
    ranges: [
      { color: '#15803d', label: '85 - 100', desc: 'Optimal Fertility' },
      { color: '#84cc16', label: '70 - 84', desc: 'Good Condition' },
      { color: '#eab308', label: '55 - 69', desc: 'Moderate / Caution' },
      { color: '#ea580c', label: '40 - 54', desc: 'Low Nutrient' },
      { color: '#dc2626', label: '< 40', desc: 'Critical / Degraded' }
    ],
    extractValue: (s) => s.overall / 100
  },
  moisture: {
    label: 'Soil Moisture',
    unit: '%',
    gradient: {
      0.2: '#ef4444', // Red: Very Dry (<25%)
      0.4: '#f97316', // Orange: Low (25-35%)
      0.7: '#22c55e', // Green: Optimal (40-55%)
      1.0: '#0284c7'  // Blue: Saturated / Wet (>60%)
    },
    ranges: [
      { color: '#0284c7', label: '> 60%', desc: 'Saturated / Wet' },
      { color: '#22c55e', label: '40% - 55%', desc: 'Optimal Moisture' },
      { color: '#f97316', label: '25% - 39%', desc: 'Low / Drying' },
      { color: '#ef4444', label: '< 25%', desc: 'Deficient / Very Dry' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, (s.moisture - 20) / 50))
  },
  ph: {
    label: 'Soil pH Level',
    unit: 'pH',
    gradient: {
      0.2: '#dc2626', // Red: Strong Acid (<5.5)
      0.5: '#eab308', // Yellow: Slight Acid (5.8 - 6.2)
      0.8: '#16a34a', // Green: Optimal Neutral (6.3 - 7.0)
      1.0: '#7c3aed'  // Purple: Alkaline (>7.5)
    },
    ranges: [
      { color: '#7c3aed', label: '> 7.5', desc: 'Alkaline' },
      { color: '#16a34a', label: '6.3 - 7.0', desc: 'Optimal Neutral' },
      { color: '#eab308', label: '5.8 - 6.2', desc: 'Slightly Acidic' },
      { color: '#dc2626', label: '< 5.5', desc: 'Strongly Acidic' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, (s.ph - 4.5) / 4.0))
  },
  npk: {
    label: 'NPK Compound Ratio',
    unit: 'mg/kg',
    gradient: {
      0.2: '#dc2626', // Red: Severely Deficient
      0.5: '#d97706', // Amber: Low
      0.8: '#15803d', // Green: Balanced / Optimal
      1.0: '#1e40af'  // Blue: High / Excess
    },
    ranges: [
      { color: '#1e40af', label: 'High', desc: 'Rich / Excessive NPK' },
      { color: '#15803d', label: 'Balanced', desc: 'Optimal Macronutrients' },
      { color: '#d97706', label: 'Low', desc: 'Nutrient Depleted' },
      { color: '#dc2626', label: 'Deficient', desc: 'Severe Shortage' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, (s.n + s.p + s.k) / 160))
  }
};

const initialMissions = [
  {
    id: 'MSN-001',
    name: 'UST Field Comprehensive Scan',
    location: 'UST Field',
    date: '2026-08-30',
    status: 'Active',
    boundary: ustFieldBoundary,
    waypoints: [
      [14.6094, 120.9896],
      [14.6096, 120.9899],
      [14.6091, 120.9902],
      [14.6088, 120.9898]
    ],
    samples: ustFieldSamples,
    summary: 'Active scan on UST Field. Heatmap restricted strictly inside the perimeter.',
    stats: { avgPh: 6.5, avgMoisture: '44%', avgEC: '1.2 dS/m', totalDistance: '142m', samplesCollected: 16 }
  }
];

export default function FieldMapView() {
  const [plots, setPlots] = useState(initialPlots);
  const [missions, setMissions] = useState(initialMissions);
  const [selectedMissionId, setSelectedMissionId] = useState('MSN-001');
  const [selectedLayerKey, setSelectedLayerKey] = useState('overall');
  const [activeMission, setActiveMission] = useState(null);

  // Live Rover Telemetry
  const [roverPos, setRoverPos] = useState([14.6094, 120.9896]);
  const [roverHeading, setRoverHeading] = useState(45);
  const [currentWaypointIdx, setCurrentWaypointIdx] = useState(0);

  // Mission Wizard State
  const [wizardStep, setWizardStep] = useState('IDLE');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newMission, setNewMission] = useState({ name: '', location: 'UST Field', date: new Date().toISOString().slice(0, 10) });

  const [tempBoundary, setTempBoundary] = useState([]);
  const [tempWaypoints, setTempWaypoints] = useState([]);
  const [notification, setNotification] = useState(null);

  // Plot CRUD inline state
  const [isManagingPlots, setIsManagingPlots] = useState(false);
  const [newPlotInput, setNewPlotInput] = useState('');
  const [editingPlotIndex, setEditingPlotIndex] = useState(null);
  const [editPlotInput, setEditPlotInput] = useState('');
  const [plotError, setPlotError] = useState(null);

  const currentSelected = missions.find(m => m.id === selectedMissionId) || missions[0];
  const activeConfig = layerConfigurations[selectedLayerKey];

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
    if (wizardStep === 'DRAWING_BOUNDARY') {
      setTempBoundary(prev => [...prev, coords]);
    } else if (wizardStep === 'PLACING_PINS') {
      if (tempBoundary.length >= 3 && !isPointInPolygon(coords, tempBoundary)) {
        setNotification({ type: 'error', message: 'Waypoints must be placed inside the defined field boundary.' });
        return;
      }
      setTempWaypoints(prev => [...prev, coords]);
    }
  };

  const handleStartMissionSetup = () => {
    if (!newMission.name.trim()) return;
    setIsModalOpen(false);
    setWizardStep('DRAWING_BOUNDARY');
    setTempBoundary([]);
    setTempWaypoints([]);
    setNotification({ type: 'info', message: 'Step 1: Click around the perimeter of the field to draw the boundary.' });
  };

  const handleConfirmBoundary = () => {
    if (tempBoundary.length < 3) {
      setNotification({ type: 'error', message: 'Please click at least 3 points on the map to define a closed boundary.' });
      return;
    }
    setWizardStep('PLACING_PINS');
    setNotification({ type: 'info', message: 'Step 2: Now click inside the boundary to place rover traversal waypoints.' });
  };

  const handleLaunchMission = () => {
    if (tempWaypoints.length === 0) {
      setNotification({ type: 'error', message: 'Please add at least 1 traversal waypoint inside the boundary.' });
      return;
    }

    const syntheticSamples = tempWaypoints.map((pt, i) => ({
      coords: pt,
      moisture: 38 + (i * 4) % 15,
      ph: 6.0 + (i * 0.2) % 0.8,
      n: 20 + (i * 3) % 15,
      p: 30 + (i * 2) % 15,
      k: 45 + (i * 4) % 20,
      overall: 70 + (i * 6) % 25
    }));

    const missionObj = {
      id: `MSN-00${missions.length + 1}`,
      name: newMission.name,
      location: newMission.location,
      date: newMission.date,
      status: 'Active',
      boundary: tempBoundary,
      waypoints: tempWaypoints,
      samples: syntheticSamples,
      summary: 'Mission in progress. Real-time multi-variable heatmap calculated.',
      stats: {
        avgPh: 6.4,
        avgMoisture: '42%',
        avgEC: '1.2 dS/m',
        totalDistance: `${calculatePolygonArea(tempBoundary)} m²`,
        samplesCollected: tempWaypoints.length
      }
    };

    setMissions(prev => [missionObj, ...prev]);
    setActiveMission(missionObj);
    setSelectedMissionId(missionObj.id);
    setCurrentWaypointIdx(0);
    setWizardStep('IDLE');
    setNotification({ type: 'success', message: `Mission "${missionObj.name}" launched with multi-layer heatmap!` });
  };

  const handleFinishMission = (id) => {
    setMissions(prev => prev.map(m => m.id === id ? { ...m, status: 'Finished', summary: 'Mission finished. Boundary and telemetry stored.' } : m));
    if (activeMission?.id === id) setActiveMission(null);
    setNotification({ type: 'success', message: `Mission completed and findings logged.` });
  };

  const handleAdvanceWaypoint = () => {
    const activePins = wizardStep !== 'IDLE' ? tempWaypoints : (currentSelected?.waypoints || []);
    if (currentWaypointIdx < activePins.length - 1) {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx(prev => prev + 1);
    } else {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx(activePins.length);
    }
  };

  const activeBoundary = wizardStep !== 'IDLE' ? tempBoundary : (currentSelected?.boundary || []);
  const displayedWaypoints = wizardStep !== 'IDLE' ? tempWaypoints : (currentSelected?.waypoints || []);

  // Format heat points dynamically based on the selected layer
  const currentSamples = currentSelected?.samples || [];
  const heatPointsForLayer = currentSamples.map(s => [
    s.coords[0],
    s.coords[1],
    activeConfig.extractValue(s)
  ]);

  const fieldAreaSqMeters = calculatePolygonArea(activeBoundary);

  return (
    <div className="field-map-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Field Map & Heatmap Analysis</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Multi-variable GIS heatmap layers, bounded spatial interpolation, and color-coded soil health gradients.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {wizardStep === 'DRAWING_BOUNDARY' && (
            <>
              <button
                className="badge"
                onClick={handleConfirmBoundary}
                style={{ cursor: 'pointer', padding: '8px 16px', background: 'var(--primary-green)', color: '#fff' }}
              >
                <Check size={16} /> Complete Boundary ({tempBoundary.length} points)
              </button>
              <button
                className="badge"
                onClick={() => { setWizardStep('IDLE'); setTempBoundary([]); }}
                style={{ cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          )}

          {wizardStep === 'PLACING_PINS' && (
            <>
              <button
                className="badge badge-connected"
                onClick={handleLaunchMission}
                style={{ cursor: 'pointer', padding: '8px 16px', background: 'var(--primary-green)', color: '#fff' }}
              >
                <Play size={16} /> Launch Mission ({tempWaypoints.length} Pins)
              </button>
              <button
                className="badge"
                onClick={() => { setWizardStep('DRAWING_BOUNDARY'); setTempWaypoints([]); }}
                style={{ cursor: 'pointer' }}
              >
                Back to Boundary
              </button>
            </>
          )}

          {wizardStep === 'IDLE' && (
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

      {/* Notification Alert */}
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
                        setWizardStep('IDLE');
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

        {/* Center Column: Interactive Map with Layer Selection & Color Guide */}
        <div className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">
              {wizardStep === 'DRAWING_BOUNDARY'
                ? '✏️ Step 1: Drawing Perimeter Boundary'
                : wizardStep === 'PLACING_PINS'
                ? '📍 Step 2: Placing Waypoints Inside Boundary'
                : `Heatmap: ${currentSelected?.name || 'Active'}`}
            </span>

            {/* Layer Selection Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={14} color="var(--primary-green)" />
              <select
                value={selectedLayerKey}
                onChange={(e) => setSelectedLayerKey(e.target.value)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--card-border)',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  outline: 'none',
                  background: '#fff',
                  color: 'var(--text-dark)'
                }}
              >
                <option value="overall">Overall Soil Health</option>
                <option value="moisture">Soil Moisture</option>
                <option value="ph">Soil pH</option>
                <option value="npk">NPK Ratio</option>
              </select>
            </div>
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            <HeatmapMap
              center={[14.6095, 120.9895]}
              zoom={18}
              boundary={activeBoundary}
              waypoints={displayedWaypoints}
              heatPoints={heatPointsForLayer}
              roverPos={roverPos}
              onMapClick={handleMapClick}
              interactionMode={
                wizardStep === 'DRAWING_BOUNDARY'
                  ? 'DRAW_BOUNDARY'
                  : wizardStep === 'PLACING_PINS'
                  ? 'SET_WAYPOINTS'
                  : 'NONE'
              }
              gradient={activeConfig.gradient}
            />

            {/* Floating Color Legend Guide Overlay */}
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              zIndex: 1000,
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(4px)',
              border: '1px solid var(--card-border)',
              borderRadius: '8px',
              padding: '10px 12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              fontSize: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxWidth: '220px'
            }}>
              <div style={{ fontWeight: 800, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Info size={13} color="var(--primary-green)" />
                <span>{activeConfig.label} ({activeConfig.unit})</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {activeConfig.ranges.map((range, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '3px',
                      background: range.color,
                      flexShrink: 0
                    }} />
                    <span style={{ fontWeight: 700, minWidth: '60px' }}>{range.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{range.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Mission Overview & Operator Traversal Guide */}
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
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Sample Density</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{displayedWaypoints.length} pts</div>
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

          {/* Traversal Guidance Card */}
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
                placeholder="e.g., UST Field Spatial Scan"
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
                Next: Draw Field Boundary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}