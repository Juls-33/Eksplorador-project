import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Play,
  Pause,
  RotateCcw,
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
import { isPointInPolygon, calculatePolygonArea, calculateDistance } from '../utils/geo';
import { saveSoilSample, fetchMissionSamples } from '../services/db';

// --- Static Initial Data & Layer Configurations ---
const initialPlots = ['UST Field', 'North Plot A', 'South Plot B'];

const ustFieldBoundary = [
  [14.6097, 120.9888],
  [14.6105, 120.9901],
  [14.6090, 120.9912],
  [14.6082, 120.9898]
];

const ustFieldSamples = [
  { coords: [14.6094, 120.9896], lat: 14.6094, lng: 120.9896, moisture: 46, ph: 6.5, n: 28, p: 38, k: 58, overall: 92 },
  { coords: [14.6096, 120.9899], lat: 14.6096, lng: 120.9899, moisture: 42, ph: 6.4, n: 24, p: 35, k: 52, overall: 88 },
  { coords: [14.6091, 120.9902], lat: 14.6091, lng: 120.9902, moisture: 38, ph: 6.1, n: 20, p: 30, k: 45, overall: 75 },
  { coords: [14.6088, 120.9898], lat: 14.6088, lng: 120.9898, moisture: 34, ph: 5.8, n: 16, p: 25, k: 38, overall: 60 }
];

const layerConfigurations = {
  overall: {
    label: 'Overall Soil Health',
    unit: 'Score / 100',
    gradient: {
      0.2: '#dc2626',
      0.4: '#ea580c',
      0.6: '#eab308',
      0.8: '#84cc16',
      1.0: '#15803d'
    },
    ranges: [
      { color: '#15803d', label: '85 - 100', desc: 'Optimal Fertility' },
      { color: '#84cc16', label: '70 - 84', desc: 'Good Condition' },
      { color: '#eab308', label: '55 - 69', desc: 'Moderate / Caution' },
      { color: '#ea580c', label: '40 - 54', desc: 'Low Nutrient' },
      { color: '#dc2626', label: '< 40', desc: 'Critical / Degraded' }
    ],
    extractValue: (s) => (s.overall || 50) / 100
  },
  moisture: {
    label: 'Soil Moisture',
    unit: '%',
    gradient: {
      0.2: '#ef4444',
      0.4: '#f97316',
      0.7: '#22c55e',
      1.0: '#0284c7'
    },
    ranges: [
      { color: '#0284c7', label: '> 60%', desc: 'Saturated / Wet' },
      { color: '#22c55e', label: '40% - 55%', desc: 'Optimal Moisture' },
      { color: '#f97316', label: '25% - 39%', desc: 'Low / Drying' },
      { color: '#ef4444', label: '< 25%', desc: 'Deficient / Very Dry' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, ((s.moisture || 0) - 20) / 50))
  },
  ph: {
    label: 'Soil pH Level',
    unit: 'pH',
    gradient: {
      0.2: '#dc2626',
      0.5: '#eab308',
      0.8: '#16a34a',
      1.0: '#7c3aed'
    },
    ranges: [
      { color: '#7c3aed', label: '> 7.5', desc: 'Alkaline' },
      { color: '#16a34a', label: '6.3 - 7.0', desc: 'Optimal Neutral' },
      { color: '#eab308', label: '5.8 - 6.2', desc: 'Slightly Acidic' },
      { color: '#dc2626', label: '< 5.5', desc: 'Strongly Acidic' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, ((s.ph || 7) - 4.5) / 4.0))
  },
  npk: {
    label: 'NPK Compound Ratio',
    unit: 'mg/kg',
    gradient: {
      0.2: '#dc2626',
      0.5: '#d97706',
      0.8: '#15803d',
      1.0: '#1e40af'
    },
    ranges: [
      { color: '#1e40af', label: 'High', desc: 'Rich / Excessive NPK' },
      { color: '#15803d', label: 'Balanced', desc: 'Optimal Macronutrients' },
      { color: '#d97706', label: 'Low', desc: 'Nutrient Depleted' },
      { color: '#dc2626', label: 'Deficient', desc: 'Severe Shortage' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, ((s.n || 0) + (s.p || 0) + (s.k || 0)) / 160))
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
    summary: 'Active scan on UST Field. Heatmap restricted strictly inside perimeter.',
    stats: { avgPh: 6.2, avgMoisture: '40%', avgEC: '1.2 dS/m', totalDistance: '142m', samplesCollected: 4 }
  }
];

export default function FieldMapView() {
  const [plots, setPlots] = useState(initialPlots);
  const [missions, setMissions] = useState(initialMissions);
  const [selectedMissionId, setSelectedMissionId] = useState('MSN-001');
  const [selectedLayerKey, setSelectedLayerKey] = useState('overall');
  const [activeMission, setActiveMission] = useState(null);

  // Mission Logging Telemetry State Machine
  const [missionState, setMissionState] = useState('IDLE'); // IDLE, IN_PROGRESS, PAUSED, FINISHED
  const [liveSamples, setLiveSamples] = useState([]);
  const [lastSampleCoord, setLastSampleCoord] = useState(null);

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

  // Plot Management Inline State
  const [isManagingPlots, setIsManagingPlots] = useState(false);
  const [newPlotInput, setNewPlotInput] = useState('');
  const [editingPlotIndex, setEditingPlotIndex] = useState(null);
  const [editPlotInput, setEditPlotInput] = useState('');
  const [plotError, setPlotError] = useState(null);

  const currentSelected = missions.find((m) => m.id === selectedMissionId) || missions[0];
  const activeConfig = layerConfigurations[selectedLayerKey];
  const activeBoundary = wizardStep !== 'IDLE' ? tempBoundary : (currentSelected?.boundary || []);
  const displayedWaypoints = wizardStep !== 'IDLE' ? tempWaypoints : (currentSelected?.waypoints || []);

  const [latestSensorData, setLatestSensorData] = useState({
    moisture: '--',
    ph: '--',
    ec: '--',
    nitrogen: '--',
    phosphorus: '--',
    potassium: '--',
    soilValid: 0,
    lat: null,
    lng: null
  });

  // 1. Fetch persistent samples when switching active missions
  useEffect(() => {
    async function loadMissionData() {
      if (selectedMissionId) {
        try {
          const records = await fetchMissionSamples(selectedMissionId);
          if (records && records.length > 0) {
            setLiveSamples(records);
          } else {
            setLiveSamples(currentSelected?.samples || []);
          }
        } catch (e) {
          setLiveSamples(currentSelected?.samples || []);
        }
      }
    }
    loadMissionData();
  }, [selectedMissionId]);

  // 2. Tauri Serial/Sensor Live Data Listener
  useEffect(() => {
    const unlistenPromise = listen('sensor-data', async (event) => {
      const data = event.payload;
      if (data.error) return;

      // Always update latest real-time readings for the telemetry monitor card
      setLatestSensorData(data);

      // Only process mission database saving if logging is active
      if (missionState !== 'IN_PROGRESS') return;

      const hasFix = data.lat && (data.lat !== 0 || data.lng !== 0);
      const isProbeInserted = data.soilValid === 1;

      if (hasFix && isProbeInserted) {
        const currentCoord = [data.lat, data.lng];

        if (activeBoundary.length >= 3 && !isPointInPolygon(currentCoord, activeBoundary)) {
          return;
        }

        if (lastSampleCoord) {
          const distance = calculateDistance(lastSampleCoord, currentCoord);
          if (distance < 5) return;
        }

        const newSample = {
          mission_id: selectedMissionId,
          coords: currentCoord,
          lat: data.lat,
          lng: data.lng,
          moisture: data.moisture,
          ph: data.ph,
          ec: data.ec,
          n: data.nitrogen,
          p: data.phosphorus,
          k: data.potassium,
          overall: Math.round((data.moisture + data.ph * 10) / 2),
          timestamp: new Date().toISOString()
        };

        await saveSoilSample(newSample);
        setLiveSamples((prev) => [...prev, newSample]);
        setLastSampleCoord(currentCoord);
        setRoverPos(currentCoord);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [missionState, selectedMissionId, activeBoundary, lastSampleCoord]);

  // Format dynamic heat points from state
  const heatPointsForLayer = liveSamples.map((s) => [
    s.lat || s.coords?.[0],
    s.lng || s.coords?.[1],
    activeConfig.extractValue(s)
  ]);

  const groupedMissions = missions.reduce((acc, msn) => {
    acc[msn.location] = acc[msn.location] || [];
    acc[msn.location].push(msn);
    return acc;
  }, {});

  const isPlotUsed = (plotName) => missions.some((m) => m.location === plotName);

  const handleAddPlot = () => {
    const trimmed = newPlotInput.trim();
    if (!trimmed) return;
    if (plots.includes(trimmed)) {
      setPlotError('Plot name already exists.');
      return;
    }
    setPlots((prev) => [...prev, trimmed]);
    setNewMission((prev) => ({ ...prev, location: trimmed }));
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

    setPlots((prev) => prev.map((p, i) => (i === index ? trimmed : p)));
    setMissions((prev) => prev.map((m) => (m.location === oldName ? { ...m, location: trimmed } : m)));

    if (newMission.location === oldName) {
      setNewMission((prev) => ({ ...prev, location: trimmed }));
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
    const updated = plots.filter((p) => p !== plotName);
    setPlots(updated);
    if (newMission.location === plotName) {
      setNewMission((prev) => ({ ...prev, location: updated[0] || '' }));
    }
    setPlotError(null);
  };

  const handleMapClick = (coords) => {
    if (wizardStep === 'DRAWING_BOUNDARY') {
      setTempBoundary((prev) => [...prev, coords]);
    } else if (wizardStep === 'PLACING_PINS') {
      if (tempBoundary.length >= 3 && !isPointInPolygon(coords, tempBoundary)) {
        setNotification({ type: 'error', message: 'Waypoints must be placed inside the defined field boundary.' });
        return;
      }
      setTempWaypoints((prev) => [...prev, coords]);
    }
  };

  const handleStartMissionSetup = () => {
    if (!newMission.name.trim()) return;
    setIsModalOpen(false);
    setWizardStep('DRAWING_BOUNDARY');
    setTempBoundary([]);
    setTempWaypoints([]);
    setNotification({ type: 'info', message: 'Step 1: Click around the perimeter of the field to draw boundary.' });
  };

  const handleConfirmBoundary = () => {
    if (tempBoundary.length < 3) {
      setNotification({ type: 'error', message: 'Please click at least 3 points on map to define a closed boundary.' });
      return;
    }
    setWizardStep('PLACING_PINS');
    setNotification({ type: 'info', message: 'Step 2: Click inside boundary to place rover waypoints.' });
  };

  const handleLaunchMission = () => {
    if (tempWaypoints.length === 0) {
      setNotification({ type: 'error', message: 'Please add at least 1 traversal waypoint inside boundary.' });
      return;
    }

    const missionObj = {
      id: `MSN-00${missions.length + 1}`,
      name: newMission.name,
      location: newMission.location,
      date: newMission.date,
      status: 'Active',
      boundary: tempBoundary,
      waypoints: tempWaypoints,
      samples: [],
      summary: 'Mission initiated. Real-time multi-variable heatmap calculated.',
      stats: { avgPh: 'N/A', avgMoisture: 'N/A', avgEC: 'N/A', totalDistance: `${calculatePolygonArea(tempBoundary)} m²`, samplesCollected: 0 }
    };

    setMissions((prev) => [missionObj, ...prev]);
    setActiveMission(missionObj);
    setSelectedMissionId(missionObj.id);
    setLiveSamples([]);
    setCurrentWaypointIdx(0);
    setWizardStep('IDLE');
    setMissionState('IN_PROGRESS'); // Auto-start telemetry logging state
    setNotification({ type: 'success', message: `Mission "${missionObj.name}" launched!` });
  };

  const handleFinishMission = (id) => {
    setMissions((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'Finished', summary: 'Mission finished. Boundary and telemetry stored.' } : m)));
    setMissionState('FINISHED');
    if (activeMission?.id === id) setActiveMission(null);
    setNotification({ type: 'success', message: `Mission completed and findings logged.` });
  };

  const handleAdvanceWaypoint = () => {
    const activePins = wizardStep !== 'IDLE' ? tempWaypoints : currentSelected?.waypoints || [];
    if (currentWaypointIdx < activePins.length - 1) {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx((prev) => prev + 1);
    } else {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx(activePins.length);
    }
  };

  return (
    <div className="field-map-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Field Map & Heatmap Analysis</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Multi-variable GIS heatmap layers, bounded spatial interpolation, and real-time telemetry updates.
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
              <button className="badge" onClick={() => { setWizardStep('IDLE'); setTempBoundary([]); }} style={{ cursor: 'pointer' }}>
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
              <button className="badge" onClick={() => { setWizardStep('DRAWING_BOUNDARY'); setTempWaypoints([]); }} style={{ cursor: 'pointer' }}>
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
          justify: 'space-between',
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
                  {list.map((m) => (
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

        {/* Center Column: Interactive Map & Step 4 Control Toolbar */}
        <div className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">
              {wizardStep === 'DRAWING_BOUNDARY'
                ? '✏️ Step 1: Drawing Perimeter Boundary'
                : wizardStep === 'PLACING_PINS'
                ? '📍 Step 2: Placing Waypoints Inside Boundary'
                : `Heatmap: ${currentSelected?.name || 'Active'}`}
            </span>

            {/* STEP 4: Live Telemetry Logging Controls & Layer Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {wizardStep === 'IDLE' && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', borderRight: '1px solid #e2e8f0', paddingRight: '10px' }}>
                  {missionState === 'IDLE' && (
                    <button
                      className="badge"
                      style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
                      onClick={() => setMissionState('IN_PROGRESS')}
                    >
                      <Play size={12} /> Start Logging
                    </button>
                  )}

                  {missionState === 'IN_PROGRESS' && (
                    <button
                      className="badge"
                      style={{ background: '#eab308', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={() => setMissionState('PAUSED')}
                    >
                      <span className="pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />
                      <Pause size={12} /> Pause Logging
                    </button>
                  )}

                  {missionState === 'PAUSED' && (
                    <button
                      className="badge"
                      style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
                      onClick={() => setMissionState('IN_PROGRESS')}
                    >
                      <RotateCcw size={12} /> Resume
                    </button>
                  )}
                </div>
              )}

              {/* Layer Selection Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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

            {/* Floating Color Legend Guide */}
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
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: range.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, minWidth: '60px' }}>{range.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{range.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Overview & Traversal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
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
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Samples Recorded</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{liveSamples.length} pts</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Live Sensor Telemetry Monitor Card */}
          <div className="card" style={{ flexShrink: 0 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Live Rover Telemetry</span>
              <span style={{
                fontSize: '0.68rem',
                padding: '2px 8px',
                borderRadius: '12px',
                fontWeight: 700,
                background: latestSensorData.soilValid === 1 ? '#dcfce7' : '#fee2e2',
                color: latestSensorData.soilValid === 1 ? '#166534' : '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: latestSensorData.soilValid === 1 ? '#22c55e' : '#ef4444'
                }} />
                {latestSensorData.soilValid === 1 ? 'Probe Engaged' : 'Probe Lifted'}
              </span>
            </div>

            <div style={{ padding: '10px 12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Moisture</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary-green)' }}>
                    {latestSensorData.moisture}{typeof latestSensorData.moisture === 'number' ? '%' : ''}
                  </div>
                </div>

                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>pH Level</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--earth-light)' }}>
                    {latestSensorData.ph}
                  </div>
                </div>

                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>EC (dS/m)</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                    {latestSensorData.ec}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '6px' }}>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Nitrogen (N)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{latestSensorData.nitrogen}</div>
                </div>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Phosphorus (P)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{latestSensorData.phosphorus}</div>
                </div>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Potassium (K)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{latestSensorData.potassium}</div>
                </div>
              </div>
            </div>
          </div>
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
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
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
                onChange={(e) => setNewMission({ ...newMission, name: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Plot Location</label>
                <button
                  type="button"
                  onClick={() => { setIsManagingPlots(!isManagingPlots); setPlotError(null); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--primary-green)', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  {isManagingPlots ? 'Done Managing' : 'Manage Plots'}
                </button>
              </div>

              {!isManagingPlots ? (
                <select
                  value={newMission.location}
                  onChange={(e) => setNewMission({ ...newMission, location: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
                >
                  {plots.map((plot) => (
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
                      onChange={(e) => setNewPlotInput(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.8rem' }}
                    />
                    <button
                      type="button"
                      onClick={handleAddPlot}
                      style={{ background: 'var(--primary-green)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}
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
                                onChange={(e) => setEditPlotInput(e.target.value)}
                                style={{ flex: 1, padding: '2px 6px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--card-border)' }}
                              />
                              <button type="button" onClick={() => handleSaveEditPlot(index)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary-green)' }}>
                                <Check size={14} />
                              </button>
                              <button type="button" onClick={() => setEditingPlotIndex(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span style={{ fontWeight: 500 }}>
                                {plot} {used && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>(in use)</span>}
                              </span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" onClick={() => handleStartEditPlot(index)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePlot(plot)}
                                  disabled={used}
                                  style={{ background: 'transparent', border: 'none', cursor: used ? 'not-allowed' : 'pointer', color: used ? '#cbd5e1' : '#ef4444' }}
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
                onChange={(e) => setNewMission({ ...newMission, date: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button className="badge" onClick={() => setIsModalOpen(false)} style={{ cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                className="badge"
                disabled={!newMission.name.trim()}
                onClick={handleStartMissionSetup}
                style={{
                  background: newMission.name.trim() ? 'var(--primary-green)' : '#ccc',
                  color: '#fff',
                  cursor: newMission.name.trim() ? 'pointer' : 'not-allowed'
                }}
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