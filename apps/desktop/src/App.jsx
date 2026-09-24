import React, { useState, useEffect, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  LayoutDashboard,
  Map as MapIcon,
  FlaskConical,
  ClipboardList,
  Sprout,
  BarChart3,
  Settings,
  Droplets,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Radio,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload
} from 'lucide-react';
import HeatmapMap from './components/HeatmapMap';
import FieldMapView from './views/FieldMapView';
import SamplingView from './views/SamplingView';
import SoilRecordsView from './views/SoilRecordsView';
import CropAssessmentView from './views/CropAssessmentView';
import ReportsView from './views/ReportsView';
import { calculateDistanceMeters } from './utils/geo';
import './App.css';
import { exportTelemetryPackage, importTelemetryPackage } from './services/db';

// How long (ms) without a new packet before we treat the rover as disconnected
const STALE_TIMEOUT_MS = 15000;
const HISTORICAL_ASSESSMENT_MIN = 10;
const HISTORICAL_SELECTION_MAX = 20;
const HISTORICAL_MATCH_RADIUS_M = 100;
const HISTORICAL_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const parseTelemetryTime = (timestamp) => {
  if (timestamp === null || timestamp === undefined || timestamp === '') return null;

  if (typeof timestamp === 'string') {
    const timeOnlyMatch = timestamp.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (timeOnlyMatch) {
      const [, hours, minutes, seconds, fraction = '0'] = timeOnlyMatch;
      const milliseconds = Number(`0.${fraction}`) * 1000;
      return {
        value:
          Number(hours) * 60 * 60 * 1000 +
          Number(minutes) * 60 * 1000 +
          Number(seconds) * 1000 +
          milliseconds,
        timeOnly: true
      };
    }
  }

  const normalized = typeof timestamp === 'string' ? timestamp.replace(' ', 'T') : timestamp;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? { value: time, timeOnly: false } : null;
};

const calculateTimeDifference = (firstTimestamp, secondTimestamp) => {
  const first = parseTelemetryTime(firstTimestamp);
  const second = parseTelemetryTime(secondTimestamp);
  if (!first || !second || first.timeOnly !== second.timeOnly) return Infinity;

  const difference = Math.abs(first.value - second.value);
  return first.timeOnly ? Math.min(difference, ONE_DAY_MS - difference) : difference;
};

const hasValidSavedLocation = (record) => {
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0);
};

// Maps each heatmap layer option to how its value is pulled from a DB row
// and normalized to 0-1 for the heat gradient, plus that layer's own color
// scale. Normalization ranges are approximate and can be tuned against real
// field data once enough samples are collected.
const normalizeHeatValue = (value, min, max) => {
  if (value === null || value === undefined || value === '') return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;

  // Leaflet renders an intensity of 0 as transparent. Keep valid low values
  // visible at the bottom of the gradient while retaining their relative rank.
  const normalized = Math.max(0, Math.min(1, (numericValue - min) / (max - min)));
  return 0.2 + normalized * 0.8;
};

const LAYER_CONFIG = {
  moisture: {
    extract: (row) => normalizeHeatValue(row.moisture, 20, 70),
    gradient: { 0.2: '#ef4444', 0.4: '#f97316', 0.7: '#22c55e', 1.0: '#0284c7' }
  },
  ph: {
    extract: (row) => normalizeHeatValue(row.ph, 4.5, 8.5),
    gradient: { 0.2: '#dc2626', 0.5: '#eab308', 0.8: '#16a34a', 1.0: '#7c3aed' }
  },
  ec: {
    extract: (row) => normalizeHeatValue(row.ec, 0, 4),
    gradient: { 0.2: '#dc2626', 0.4: '#ea580c', 0.6: '#eab308', 0.8: '#84cc16', 1.0: '#15803d' }
  },
  nitrogen: {
    extract: (row) => normalizeHeatValue(row.nitrogen, 0, 60),
    gradient: { 0.2: '#dc2626', 0.5: '#d97706', 0.8: '#15803d', 1.0: '#1e40af' }
  },
  phosphorus: {
    extract: (row) => normalizeHeatValue(row.phosphorus, 0, 80),
    gradient: { 0.2: '#dc2626', 0.5: '#d97706', 0.8: '#15803d', 1.0: '#1e40af' }
  },
  potassium: {
    extract: (row) => normalizeHeatValue(row.potassium, 0, 100),
    gradient: { 0.2: '#dc2626', 0.5: '#d97706', 0.8: '#15803d', 1.0: '#1e40af' }
  }
};

function TelemetrySyncBar({ onImportSuccess }) {
  const fileInputRef = useRef(null);

  const handleExport = async () => {
    try {
      const result = await exportTelemetryPackage();
      alert(`Export Successful!\nSaved to project folder:\n${result.path}`);
    } catch (err) {
      alert(`Export Failed: ${err.message || err}`);
    }
  };

  const handleImport = async () => {
    try {
      const result = await importTelemetryPackage();
      if (result.cancelled) return;
      
      alert(`Import Successful!\n${result.count} telemetry records imported into eksplorador.db.`);
      if (onImportSuccess) onImportSuccess();
    } catch (err) {
      alert(`Import Failed: ${err.message || err}`);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result;
        if (typeof content === 'string') {
          const result = await importTelemetryPackage(content);
          alert(`Import Successful!\n${result.count} telemetry records merged into SQLite database.`);
          if (onImportSuccess) onImportSuccess();
        }
      } catch (err) {
        alert(`Import Failed: ${err.message}`);
      } finally {
        // Reset file input so re-importing the same file triggers onChange
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        type="button"
        className="badge"
        onClick={handleExport}
        style={{ cursor: 'pointer', background: 'var(--primary-green)', color: '#fff', display: 'flex', gap: '6px', padding: '6px 12px' }}
      >
        <Upload size={14} />
        <span>Export Data</span>
      </button>

      <button
        type="button"
        className="badge"
        onClick={handleImport}
        style={{ cursor: 'pointer', background: '#fff', color: 'var(--text-dark)', border: '1px solid var(--card-border)', display: 'flex', gap: '6px', padding: '6px 12px' }}
      >
        <Download size={14} />
        <span>Import Data</span>
      </button>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [selectedLayer, setSelectedLayer] = useState('ph');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Live sensor data — null until the first packet arrives.
  // Drives the status badges and KPI cards (current-moment readings).
  const [liveData, setLiveData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const lastPacketTime = useRef(null);

  // DB-backed telemetry history. Drives the Recent Geo-tagged Samples
  // table only now — the heatmap itself plots live readings as they
  // arrive (see rawLiveReadings below), so it updates in real time
  // instead of waiting on the periodic DB refresh.
  const [telemetryData, setTelemetryData] = useState([]);

  // Up to twenty table rows can be reviewed together as one historical heatmap.
  // Keeping the complete rows here lets layer changes reuse their saved values.
  const [selectedHistoricalRecords, setSelectedHistoricalRecords] = useState([]);

  // Historical crop recommendations are intentionally opt-in and use a
  // snapshot of at least ten selected rows. This keeps ordinary heatmap
  // exploration from replacing the live recommendation automatically.
  const [assessedHistoricalRecords, setAssessedHistoricalRecords] = useState([]);

  // Raw live readings accumulated as valid packets arrive, kept
  // unnormalized so switching the layer dropdown recolors the whole
  // heatmap immediately rather than only affecting new points.
  const [rawLiveReadings, setRawLiveReadings] = useState([]);

  const activeLayerConfig = LAYER_CONFIG[selectedLayer] ?? LAYER_CONFIG.ph;

  // Heatmap points computed from live readings, using whichever layer is
  // currently selected in the dropdown
  const liveHeatPoints = rawLiveReadings
    .map((r) => [r.lat, r.lng, activeLayerConfig.extract(r)])
    .filter((point) => point[2] !== null);

  const selectedHistoricalHeatPoints = useMemo(
    () => selectedHistoricalRecords
      .map((record) => [
        record.latitude,
        record.longitude,
        activeLayerConfig.extract(record)
      ])
      .filter((point) => point[2] !== null),
    [selectedHistoricalRecords, activeLayerConfig]
  );

  const displayedHeatPoints = selectedHistoricalRecords.length > 0
    ? selectedHistoricalHeatPoints
    : liveHeatPoints;

  const selectedHistoricalPositions = useMemo(
    () => selectedHistoricalRecords.map((record) => [record.latitude, record.longitude]),
    [selectedHistoricalRecords]
  );

  const historicalMapMarkers = useMemo(
    () => selectedHistoricalRecords.length > 0
      ? [{
          lat: selectedHistoricalRecords[0].latitude,
          lng: selectedHistoricalRecords[0].longitude,
          label: 1,
          isAnchor: true
        }]
      : [],
    [selectedHistoricalRecords]
  );

  const selectedHistoricalPos = selectedHistoricalPositions.length > 0
    ? selectedHistoricalPositions[selectedHistoricalPositions.length - 1]
    : null;

  const cropSuitability = useMemo(() => {
    const usingHistory = assessedHistoricalRecords.length >= HISTORICAL_ASSESSMENT_MIN;
    const sourceRecords = usingHistory
      ? assessedHistoricalRecords
      : liveData && liveData.soilValid === 1
        ? [liveData]
        : [];

    if (sourceRecords.length === 0) return null;

    const average = (key) => {
      const values = sourceRecords
        .map((record) => record[key])
        .filter((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)))
        .map(Number);

      return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
    };

    const ph = average('ph');
    const moisture = average('moisture');
    const nitrogen = average('nitrogen');
    const phosphorus = average('phosphorus');
    const potassium = average('potassium');
    const recommendedCrops = [];

    // Dashboard recommendations are intentionally limited to the three crops
    // selected for Eksplorador's current assessment scope.
    if (ph !== null && moisture !== null && ph >= 5.5 && ph <= 6.8 && moisture >= 35) {
      recommendedCrops.push('Rice');
    }
    if (ph !== null && moisture !== null && ph >= 5.0 && ph <= 7.5 && moisture >= 40) {
      recommendedCrops.push('Cacao');
    }
    if (ph !== null && moisture !== null && ph >= 5.0 && ph <= 6.5 && moisture >= 30) {
      recommendedCrops.push('Coffee');
    }

    const formatValue = (value) => value === null ? '--' : value.toFixed(1);

    return {
      recommendedCrops,
      sourceLabel: usingHistory
        ? `average of ${sourceRecords.length} selected historical record${sourceRecords.length === 1 ? '' : 's'}`
        : 'current live reading',
      ph: formatValue(ph),
      nitrogen: formatValue(nitrogen),
      phosphorus: formatValue(phosphorus),
      potassium: formatValue(potassium)
    };
  }, [assessedHistoricalRecords, liveData]);

  const selectHistoricalGroup = (anchorRecord) => {
    if (!hasValidSavedLocation(anchorRecord)) return;

    const anchorPosition = [anchorRecord.latitude, anchorRecord.longitude];

    const relatedRecords = telemetryData
      .filter((record) => record.id !== anchorRecord.id && hasValidSavedLocation(record))
      .map((record) => {
        const timeDifference = calculateTimeDifference(
          anchorRecord.timestamp,
          record.timestamp
        );
        const distance = calculateDistanceMeters(
          anchorPosition,
          [record.latitude, record.longitude]
        );

        return { record, timeDifference, distance };
      })
      .filter(({ timeDifference, distance }) =>
        timeDifference <= HISTORICAL_MATCH_WINDOW_MS && distance <= HISTORICAL_MATCH_RADIUS_M
      )
      .sort((a, b) => a.timeDifference - b.timeDifference || a.distance - b.distance)
      .slice(0, HISTORICAL_SELECTION_MAX - 1)
      .map(({ record }) => record);

    setAssessedHistoricalRecords([]);
    setSelectedHistoricalRecords([anchorRecord, ...relatedRecords]);
  };

  const clearHistoricalSelection = () => {
    setSelectedHistoricalRecords([]);
    setAssessedHistoricalRecords([]);
  };

  // Most recent DB record's position, used as a fallback center/marker
  // before any live GPS fix has come in this session
  const latestDbPos =
    telemetryData.length > 0 ? [telemetryData[0].latitude, telemetryData[0].longitude] : null;

  useEffect(() => {
    const unlisten = listen('sensor-data', (event) => {
      const data = event.payload;

      // Ignore malformed/error packets forwarded from the receiver
      if (data.error) {
        console.warn('Receiver reported an error:', data.error);
        return;
      }

      // Plot on the heatmap only once GPS has a fix and the soil probe
      // reading is valid — same filter the backend uses for DB inserts,
      // so the live map and the eventual historical record agree on
      // what counts as a "real" sample.
      const hasFix = data.lat && (data.lat !== 0 || data.lng !== 0);
      if (hasFix && data.soilValid === 1) {
        setRawLiveReadings((prev) =>
          [...prev, {
            lat: data.lat,
            lng: data.lng,
            moisture: data.moisture,
            ph: data.ph,
            ec: data.ec,
            nitrogen: data.nitrogen,
            phosphorus: data.phosphorus,
            potassium: data.potassium
          }].slice(-500)
        );
      }

      setLiveData(data);
      setIsConnected(true);
      lastPacketTime.current = Date.now();
    });

    // Periodically check whether the last packet is too old to trust
    const staleCheck = setInterval(() => {
      if (lastPacketTime.current && Date.now() - lastPacketTime.current > STALE_TIMEOUT_MS) {
        setIsConnected(false);
      }
    }, 2000);

    return () => {
      unlisten.then((f) => f());
      clearInterval(staleCheck);
    };
  }, []);

  useEffect(() => {
    async function loadTelemetry() {
      try {
        await invoke('init_db');
        const records = await invoke('get_recent_telemetry');
        setTelemetryData(records);
      } catch (error) {
        console.error('Failed to load telemetry from Rust Backend:', error);
      }
    }
    loadTelemetry();
    // Refresh periodically so the heatmap/table pick up new DB rows
    // as they're inserted (e.g. once averaged-sample inserts are added
    // on the Rust side)
    const refreshInterval = setInterval(loadTelemetry, 10000);
    return () => clearInterval(refreshInterval);
  }, []);

  const navItems = [
    { id: 'Dashboard', label: 'Live Monitoring', icon: LayoutDashboard },
    { id: 'Field Map', label: 'Field Map', icon: MapIcon },
    { id: 'Sampling', label: 'Sampling', icon: FlaskConical },
    { id: 'Soil Records', label: 'Soil Records', icon: ClipboardList },
    { id: 'Crop Assessment', label: 'Crop Assessment', icon: Sprout },
    { id: 'Reports', label: 'Reports', icon: BarChart3 }
  ];

  const hasGpsFix = liveData && (liveData.lat !== 0 || liveData.lng !== 0);
  const soilOk = liveData && liveData.soilValid === 1;

  return (
    <div className="dashboard-layout">
      {/* Collapsible Sidebar */}
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div>
          <div className="brand-header">
            {!isCollapsed ? (
              <>
                <div className="brand-info">
                  <Sprout size={28} color="#D99A2B" />
                  <div>
                    <div className="brand-title">EKSPLORADOR</div>
                    <div className="brand-subtitle">SOIL MONITORING</div>
                  </div>
                </div>
                <button className="sidebar-toggle-btn" onClick={() => setIsCollapsed(true)} title="Collapse Sidebar">
                  <ChevronLeft size={18} />
                </button>
              </>
            ) : (
              <button className="sidebar-toggle-btn" onClick={() => setIsCollapsed(false)} title="Expand Sidebar">
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          <nav className="nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                  title={isCollapsed ? item.label : ''}
                >
                  <Icon size={20} />
                  {!isCollapsed && <span className="nav-label">{item.label}</span>}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="nav-item" title={isCollapsed ? 'Settings' : ''}>
          <Settings size={20} />
          {!isCollapsed && <span className="nav-label">Settings</span>}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {activeTab === 'Field Map' ? (
          <FieldMapView />
        ) : activeTab === 'Sampling' ? (
          <SamplingView />
        ) : activeTab === 'Soil Records' ? (
          <SoilRecordsView />
        ) : activeTab === 'Crop Assessment' ? (
          <CropAssessmentView />
        ) : activeTab === 'Reports' ? (
          <ReportsView />
        ) : (
          <>
            <header className="top-bar">
              <div>
                <h1>Live Monitoring Board</h1>
              </div>

              {/* NEW: Telemetry Sync Actions (Export & Import) */}
              <TelemetrySyncBar 
                onImportSuccess={async () => {
                  // Re-trigger Rust DB query to update telemetry table state live
                  try {
                    const records = await invoke('get_recent_telemetry');
                    setTelemetryData(records);
                  } catch (err) {
                    console.error('Failed to reload telemetry after import:', err);
                  }
                }} 
              />
              <div className="status-badges">
                <div className="badge">
                  <span>Plot:</span>
                  <strong>North Plot A</strong>
                </div>
                <div className="badge">
                  <strong>{liveData ? `PKT #${liveData.seq}` : 'SESSION-024'}</strong>
                </div>
                <div className={`badge ${isConnected ? 'badge-connected' : ''}`}>
                  {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
                  <span>{isConnected ? 'Rover Connected' : 'Waiting for Rover'}</span>
                </div>
                <div className="badge">
                  <Radio size={14} />
                  <span>
                    LoRa {liveData ? `(RSSI ${liveData.rssi} dBm, SNR ${liveData.snr})` : ''}
                  </span>
                </div>
                <div className="badge">
                  <Navigation size={14} />
                  <span>
                    {liveData
                      ? hasGpsFix
                        ? `GPS Fix (${liveData.satsLocked} sats)`
                        : `No Fix (${liveData.satsView} in view)`
                      : 'GPS --'}
                  </span>
                </div>
                <div className="badge">
                  {soilOk ? <CheckCircle2 size={14} color="#1F5132" /> : <AlertTriangle size={14} color="#B45309" />}
                  <span>{liveData ? (soilOk ? 'Probe OK' : 'Probe Not Responding') : 'Probe --'}</span>
                </div>
              </div>
            </header>

            {/* Dashboard Telemetry Cards */}
            <section className="kpi-row">
              <div className="kpi-card">
                <div className="kpi-header">
                  <div className="kpi-icon-wrap" style={{ borderColor: '#1F5132', color: '#1F5132' }}>
                    <Droplets size={18} />
                  </div>
                  <span className="kpi-title">Soil Moisture</span>
                </div>
                <div className="kpi-value">{soilOk ? `${liveData.moisture}%` : '--'}</div>
                <div className="kpi-status">
                  <CheckCircle2 size={13} /> {soilOk ? 'Within range' : 'No valid reading'}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <div className="kpi-icon-wrap" style={{ borderColor: '#8A5A35', color: '#8A5A35' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>pH</span>
                  </div>
                  <span className="kpi-title">Soil pH</span>
                </div>
                <div className="kpi-value">{soilOk ? liveData.ph : '--'}</div>
                <div className="kpi-status">
                  <CheckCircle2 size={13} /> {soilOk ? 'Optimal' : 'No valid reading'}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <div className="kpi-icon-wrap" style={{ borderColor: '#5C3A24', color: '#5C3A24' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 800 }}>EC</span>
                  </div>
                  <span className="kpi-title">Conductivity (EC)</span>
                </div>
                <div className="kpi-value">
                  {soilOk ? liveData.ec : '--'} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>uS/cm</span>
                </div>
                <div className="kpi-status">
                  <CheckCircle2 size={13} /> {soilOk ? 'Within range' : 'No valid reading'}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <div className="kpi-icon-wrap" style={{ borderColor: '#D99A2B', color: '#D99A2B' }}>
                    <Sprout size={18} />
                  </div>
                  <span className="kpi-title">NPK Ratio</span>
                </div>
                <div className="kpi-value">
                  {soilOk ? `${liveData.nitrogen} / ${liveData.phosphorus} / ${liveData.potassium}` : '-- / -- / --'}
                  <span style={{ fontSize: '0.75rem', fontWeight: 500 }}> mg/kg</span>
                </div>
                <div className="kpi-status">
                  <CheckCircle2 size={13} /> {soilOk ? 'Balanced' : 'No valid reading'}
                </div>
              </div>
            </section>

            {/* Dashboard Workspace */}
            <section className="workspace-grid">
              <div className="card map-card">
                <div className="card-header">
                  <span className="card-title">Field Heatmap Spatial View</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={selectedLayer}
                      onChange={(e) => setSelectedLayer(e.target.value)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--card-border)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        outline: 'none'
                      }}
                    >
                      <option value="moisture">Soil Moisture</option>
                      <option value="ph">Soil pH</option>
                      <option value="ec">Electrical Conductivity</option>
                      <option value="nitrogen">Nitrogen (N)</option>
                      <option value="phosphorus">Phosphorus (P)</option>
                      <option value="potassium">Potassium (K)</option>
                    </select>
                  </div>
                </div>
                <HeatmapMap
                  center={selectedHistoricalPos || (hasGpsFix ? [liveData.lat, liveData.lng] : latestDbPos || [14.6095, 120.9890])}
                  zoom={18}
                  heatPoints={displayedHeatPoints}
                  roverPos={selectedHistoricalPos || (hasGpsFix ? [liveData.lat, liveData.lng] : latestDbPos)}
                  focusPoints={selectedHistoricalPositions}
                  labeledPoints={historicalMapMarkers}
                  gradient={activeLayerConfig.gradient}
                />
              </div>

              <div className="card live-sampling-card">
                <div className="card-header">
                  <span className="card-title">Live Sampling Queue</span>
                </div>
                <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {liveData ? (
                    <p>
                      Last packet #{liveData.seq} received just now.
                      {!hasGpsFix && ' Waiting for GPS fix.'}
                      {hasGpsFix && !soilOk && ' GPS locked, but soil probe reading invalid.'}
                      {hasGpsFix && soilOk && ' Plotted on the heatmap.'}
                      {' '}Samples table updates from saved records.
                    </p>
                  ) : (
                    <p>Awaiting next telemetry ping from rover...</p>
                  )}
                </div>
              </div>

              <div className="card recent-samples-card">
                <div className="card-header">
                  <span className="card-title">Recent Geo-tagged Samples</span>
                  <div className="historical-selection-controls">
                    <span
                      title={`Anchor plus records within ${HISTORICAL_MATCH_RADIUS_M} m and ±2 hours`}
                    >
                      {selectedHistoricalRecords.length}/{HISTORICAL_SELECTION_MAX} related
                    </span>
                    <button
                      type="button"
                      className="assess-history-btn"
                      disabled={selectedHistoricalRecords.length < HISTORICAL_ASSESSMENT_MIN}
                      onClick={() => setAssessedHistoricalRecords([...selectedHistoricalRecords])}
                      title={
                        selectedHistoricalRecords.length < HISTORICAL_ASSESSMENT_MIN
                          ? `Select at least ${HISTORICAL_ASSESSMENT_MIN} records to assess crop suitability`
                          : 'Calculate crop suitability from the selected historical records'
                      }
                    >
                      Assess historical records
                    </button>
                    {selectedHistoricalRecords.length > 0 && (
                      <button
                        type="button"
                        className="clear-history-btn"
                        onClick={clearHistoricalSelection}
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ padding: '12px', fontSize: '0.8rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--card-border)' }}>
                        <th aria-label="Select record" style={{ padding: '6px 8px', width: '32px' }}></th>
                        <th style={{ padding: '6px 8px', width: '58px' }}>ID</th>
                        <th style={{ padding: '6px 8px' }}>Time</th>
                        <th style={{ padding: '6px 8px' }}>Lat / Lng</th>
                        <th style={{ padding: '6px 8px' }}>pH</th>
                        <th style={{ padding: '6px 8px' }}>Moisture</th>
                        <th style={{ padding: '6px 8px' }}>EC</th>
                        <th style={{ padding: '6px 8px' }}>NPK (N/P/K)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetryData.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No telemetry records found.
                          </td>
                        </tr>
                      ) : (
                        telemetryData.map((row) => {
                          const hasSavedLocation = hasValidSavedLocation(row);
                          const selectedIndex = selectedHistoricalRecords.findIndex((record) => record.id === row.id);
                          const isSelected = selectedIndex >= 0;
                          const mapId = isSelected ? selectedIndex + 1 : null;

                          return (
                          <tr
                            key={row.id}
                            className={`historical-sample-row${isSelected ? ' selected' : ''}${!hasSavedLocation ? ' unavailable' : ''}`}
                            onClick={() => selectHistoricalGroup(row)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                selectHistoricalGroup(row);
                              }
                            }}
                            tabIndex={hasSavedLocation ? 0 : -1}
                            aria-selected={isSelected}
                            title={
                              !hasSavedLocation
                                ? 'This record has no saved GPS fix'
                                : 'Use this record as the anchor for an automatic historical group'
                            }
                            style={{ borderBottom: '1px solid #f1f5f9' }}
                          >
                            <td style={{ padding: '8px' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!hasSavedLocation}
                                onChange={() => selectHistoricalGroup(row)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select sample from ${row.timestamp}`}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              {mapId !== null && (
                                <span
                                  title={mapId === 1 ? 'Anchor sample' : `Related sample ${mapId}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    background: mapId === 1 ? 'var(--accent-gold)' : 'var(--primary-green)',
                                    color: '#fff',
                                    fontSize: '0.72rem',
                                    fontWeight: 800
                                  }}
                                >
                                  {mapId}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px' }}>{row.timestamp}</td>
                            <td style={{ padding: '8px' }}>
                              {row.latitude !== 0 || row.longitude !== 0
                                ? `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`
                                : 'No fix'}
                            </td>
                            <td style={{ padding: '8px' }}>{row.ph}</td>
                            <td style={{ padding: '8px' }}>{row.moisture}%</td>
                            <td style={{ padding: '8px' }}>{row.ec} uS/cm</td>
                            <td style={{ padding: '8px' }}>
                              {row.nitrogen ?? '--'} / {row.phosphorus ?? '--'} / {row.potassium ?? '--'}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card crop-suitability-card">
                <div className="card-header">
                  <span className="card-title">Crop Suitability</span>
                </div>
                <div style={{ padding: '16px', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--primary-green)', marginBottom: '4px' }}>
                    {cropSuitability
                      ? cropSuitability.recommendedCrops.length > 0
                        ? `Recommended: ${cropSuitability.recommendedCrops.join(' & ')}`
                        : 'No strong match among Rice, Cacao, or Coffee'
                      : 'Awaiting valid soil data'}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {cropSuitability
                      ? `Based on the ${cropSuitability.sourceLabel}: pH ${cropSuitability.ph}, NPK ${cropSuitability.nitrogen} / ${cropSuitability.phosphorus} / ${cropSuitability.potassium} mg/kg.`
                      : 'Recommendations will appear once a valid soil reading is received.'}
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
