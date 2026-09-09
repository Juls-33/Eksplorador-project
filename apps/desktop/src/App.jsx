import React, { useState, useEffect, useRef } from 'react';
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
  ChevronRight
} from 'lucide-react';
import HeatmapMap from './components/HeatmapMap';
import FieldMapView from './views/FieldMapView';
import SamplingView from './views/SamplingView';
import SoilRecordsView from './views/SoilRecordsView';
import CropAssessmentView from './views/CropAssessmentView';
import ReportsView from './views/ReportsView';
import './App.css';

// How long (ms) without a new packet before we treat the rover as disconnected
const STALE_TIMEOUT_MS = 15000;

// Maps each heatmap layer option to how its value is pulled from a DB row
// and normalized to 0-1 for the heat gradient, plus that layer's own color
// scale. Normalization ranges are approximate and can be tuned against real
// field data once enough samples are collected.
const LAYER_CONFIG = {
  moisture: {
    extract: (row) => Math.max(0, Math.min(1, (row.moisture - 20) / 50)),
    gradient: { 0.2: '#ef4444', 0.4: '#f97316', 0.7: '#22c55e', 1.0: '#0284c7' }
  },
  ph: {
    extract: (row) => Math.max(0, Math.min(1, (row.ph - 4.5) / 4.0)),
    gradient: { 0.2: '#dc2626', 0.5: '#eab308', 0.8: '#16a34a', 1.0: '#7c3aed' }
  },
  ec: {
    extract: (row) => Math.max(0, Math.min(1, row.ec / 4)),
    gradient: { 0.2: '#dc2626', 0.4: '#ea580c', 0.6: '#eab308', 0.8: '#84cc16', 1.0: '#15803d' }
  },
  nitrogen: {
    extract: (row) => Math.max(0, Math.min(1, (row.nitrogen ?? 0) / 60)),
    gradient: { 0.2: '#dc2626', 0.5: '#d97706', 0.8: '#15803d', 1.0: '#1e40af' }
  },
  phosphorus: {
    extract: (row) => Math.max(0, Math.min(1, (row.phosphorus ?? 0) / 80)),
    gradient: { 0.2: '#dc2626', 0.5: '#d97706', 0.8: '#15803d', 1.0: '#1e40af' }
  },
  potassium: {
    extract: (row) => Math.max(0, Math.min(1, (row.potassium ?? 0) / 100)),
    gradient: { 0.2: '#dc2626', 0.5: '#d97706', 0.8: '#15803d', 1.0: '#1e40af' }
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [selectedLayer, setSelectedLayer] = useState('ph');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Live sensor data — null until the first packet arrives.
  // Drives the status badges and KPI cards (current-moment readings).
  const [liveData, setLiveData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const lastPacketTime = useRef(null);

  // DB-backed telemetry history. Drives the Heatmap and the Recent
  // Geo-tagged Samples table — these show validated/aggregated readings
  // pulled from SQLite rather than raw live packets, so the map and
  // table don't fill up with every single transmission (including
  // invalid/no-fix ones) as the rover runs.
  const [telemetryData, setTelemetryData] = useState([]);

  const activeLayerConfig = LAYER_CONFIG[selectedLayer] ?? LAYER_CONFIG.ph;

  // Heatmap points derived from DB records, using whichever layer is
  // currently selected in the dropdown
  const dbHeatPoints = telemetryData
    .filter((row) => row.latitude !== 0 || row.longitude !== 0)
    .map((row) => [row.latitude, row.longitude, activeLayerConfig.extract(row)]);

  // Most recent DB record's position, used to center the map / show the
  // last-known rover marker when no live GPS fix is currently available
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
    { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
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
                <h1>Field Monitoring Board</h1>
              </div>
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
                  center={hasGpsFix ? [liveData.lat, liveData.lng] : latestDbPos || [14.6095, 120.9890]}
                  zoom={18}
                  heatPoints={dbHeatPoints}
                  roverPos={hasGpsFix ? [liveData.lat, liveData.lng] : latestDbPos}
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
                      {' '}Map and table update from saved records.
                    </p>
                  ) : (
                    <p>Awaiting next telemetry ping from rover...</p>
                  )}
                </div>
              </div>

              <div className="card recent-samples-card">
                <div className="card-header">
                  <span className="card-title">Recent Geo-tagged Samples</span>
                </div>
                <div style={{ padding: '12px', fontSize: '0.8rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--card-border)' }}>
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
                          <td colSpan={6} style={{ padding: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No telemetry records found.
                          </td>
                        </tr>
                      ) : (
                        telemetryData.map((row) => (
                          <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
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
                        ))
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
                    {soilOk ? 'High Suitability: Rice & Corn' : 'Awaiting valid soil data'}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {soilOk
                      ? `Based on current NPK and ${liveData.ph} pH readings.`
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