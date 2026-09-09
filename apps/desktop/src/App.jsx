import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
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

export default function App() {
  const [activeTab, setActiveTab] = useState('Reports');
  const [selectedLayer, setSelectedLayer] = useState('ph');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Live sensor data — null until the first packet arrives
  const [liveData, setLiveData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [recentSamples, setRecentSamples] = useState([]);
  const [heatPoints, setHeatPoints] = useState([]);

  const lastPacketTime = useRef(null);

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

      setRecentSamples((prev) => {
        const entry = { time: new Date().toLocaleTimeString(), ...data };
        return [entry, ...prev].slice(0, 10);
      });

      // Only plot on the heatmap once GPS actually has a fix (lat/lng != 0)
      // and the soil probe reading is valid for that point
      if (data.lat && data.lng && (data.lat !== 0 || data.lng !== 0) && data.soilValid === 1) {
        setHeatPoints((prev) => {
          const normalizedPh = Math.max(0, Math.min(1, data.ph / 14));
          return [...prev, [data.lat, data.lng, normalizedPh]].slice(-200);
        });
      }
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
                    </select>
                  </div>
                </div>
                <HeatmapMap
                  center={hasGpsFix ? [liveData.lat, liveData.lng] : [14.6095, 120.9890]}
                  zoom={18}
                  heatPoints={heatPoints}
                  roverPos={hasGpsFix ? [liveData.lat, liveData.lng] : null}
                />
              </div>

              <div className="card live-sampling-card">
                <div className="card-header">
                  <span className="card-title">Live Sampling Queue</span>
                </div>
                <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {liveData ? (
                    <p>
                      Last packet #{liveData.seq} received at {recentSamples[0]?.time}
                      {!hasGpsFix && ' — waiting for GPS fix before plotting on map.'}
                      {hasGpsFix && !soilOk && ' — GPS locked, but soil probe reading invalid.'}
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
                      </tr>
                    </thead>
                    <tbody>
                      {recentSamples.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: '8px', color: 'var(--text-muted)' }}>
                            No samples received yet.
                          </td>
                        </tr>
                      ) : (
                        recentSamples.map((sample, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px' }}>{sample.time}</td>
                            <td style={{ padding: '8px' }}>
                              {sample.lat !== 0 || sample.lng !== 0
                                ? `${sample.lat.toFixed(5)}, ${sample.lng.toFixed(5)}`
                                : 'No fix'}
                            </td>
                            <td style={{ padding: '8px' }}>{sample.soilValid === 1 ? sample.ph : '--'}</td>
                            <td style={{ padding: '8px' }}>{sample.soilValid === 1 ? `${sample.moisture}%` : '--'}</td>
                            <td style={{ padding: '8px' }}>{sample.soilValid === 1 ? `${sample.ec} uS/cm` : '--'}</td>
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