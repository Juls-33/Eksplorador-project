import React, { useState } from 'react';
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
  Wifi,
  Radio,
  Navigation,
  BatteryCharging,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import HeatmapMap from './components/HeatmapMap';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [selectedLayer, setSelectedLayer] = useState('ph');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [samplePoints] = useState([
    [14.5995, 120.9842, 0.9],
    [14.5997, 120.9844, 0.6],
    [14.5993, 120.9840, 0.4],
    [14.5998, 120.9847, 0.8],
    [14.5991, 120.9838, 0.3]
  ]);

  const navItems = [
    { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'Field Map', label: 'Field Map', icon: MapIcon },
    { id: 'Sampling', label: 'Sampling', icon: FlaskConical },
    { id: 'Soil Records', label: 'Soil Records', icon: ClipboardList },
    { id: 'Crop Assessment', label: 'Crop Assessment', icon: Sprout },
    { id: 'Reports', label: 'Reports', icon: BarChart3 }
  ];

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
                <button
                  className="sidebar-toggle-btn"
                  onClick={() => setIsCollapsed(true)}
                  title="Collapse Sidebar"
                >
                  <ChevronLeft size={18} />
                </button>
              </>
            ) : (
              <button
                className="sidebar-toggle-btn"
                onClick={() => setIsCollapsed(false)}
                title="Expand Sidebar"
              >
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
              <strong>SESSION-024</strong>
            </div>
            <div className="badge badge-connected">
              <Wifi size={14} />
              <span>Rover Connected</span>
            </div>
            <div className="badge">
              <Radio size={14} />
              <span>LoRA</span>
            </div>
            <div className="badge">
              <Navigation size={14} />
              <span>GPS 3D Fix</span>
            </div>
            <div className="badge">
              <BatteryCharging size={14} color="#1F5132" />
              <span>82%</span>
            </div>
          </div>
        </header>

        {/* Telemetry Cards */}
        <section className="kpi-row">
          <div className="kpi-card">
            <div className="kpi-header">
              <div className="kpi-icon-wrap" style={{ borderColor: '#1F5132', color: '#1F5132' }}>
                <Droplets size={18} />
              </div>
              <span className="kpi-title">Soil Moisture</span>
            </div>
            <div className="kpi-value">42%</div>
            <div className="kpi-status"><CheckCircle2 size={13} /> Within range</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <div className="kpi-icon-wrap" style={{ borderColor: '#8A5A35', color: '#8A5A35' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>pH</span>
              </div>
              <span className="kpi-title">Soil pH</span>
            </div>
            <div className="kpi-value">6.4</div>
            <div className="kpi-status"><CheckCircle2 size={13} /> Optimal</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <div className="kpi-icon-wrap" style={{ borderColor: '#5C3A24', color: '#5C3A24' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800 }}>EC</span>
              </div>
              <span className="kpi-title">Conductivity (EC)</span>
            </div>
            <div className="kpi-value">1.2 <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>dS/m</span></div>
            <div className="kpi-status"><CheckCircle2 size={13} /> Within range</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <div className="kpi-icon-wrap" style={{ borderColor: '#D99A2B', color: '#D99A2B' }}>
                <Sprout size={18} />
              </div>
              <span className="kpi-title">NPK Ratio</span>
            </div>
            <div className="kpi-value">1.2 / 38 / 55 <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>mg/kg</span></div>
            <div className="kpi-status"><CheckCircle2 size={13} /> Balanced</div>
          </div>
        </section>

        {/* Workspace Grid */}
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
              center={[14.5995, 120.9842]}
              zoom={18}
              heatPoints={samplePoints}
              roverPos={[14.5995, 120.9842]}
            />
          </div>

          <div className="card live-sampling-card">
            <div className="card-header">
              <span className="card-title">Live Sampling Queue</span>
            </div>
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <p>Awaiting next telemetry ping from rover...</p>
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
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px' }}>14:28:10</td>
                    <td style={{ padding: '8px' }}>14.5995, 120.9842</td>
                    <td style={{ padding: '8px' }}>6.4</td>
                    <td style={{ padding: '8px' }}>42%</td>
                    <td style={{ padding: '8px' }}>1.2 dS/m</td>
                  </tr>
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
                High Suitability: Rice & Corn
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Based on current NPK and 6.4 pH readings.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}