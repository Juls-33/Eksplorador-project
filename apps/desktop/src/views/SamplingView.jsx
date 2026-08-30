import React, { useState } from 'react';
import {
  Download,
  Filter,
  Search,
  Radio,
  MapPin,
  Clock,
  Droplets,
  Activity,
  Layers,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';

const mockSamples = [
  {
    id: 'SMP-1048',
    timestamp: '2026-08-30 14:32:05',
    plot: 'North Plot A',
    mission: 'MSN-001',
    coords: [14.6095, 120.9890],
    moisture: 42.5,
    ph: 6.4,
    ec: 1.25,
    salinity: 640,
    n: 24,
    p: 38,
    k: 55,
    quality: '3D Fix (8 Sats)'
  },
  {
    id: 'SMP-1047',
    timestamp: '2026-08-30 14:30:18',
    plot: 'North Plot A',
    mission: 'MSN-001',
    coords: [14.6098, 120.9894],
    moisture: 45.2,
    ph: 6.3,
    ec: 1.30,
    salinity: 665,
    n: 22,
    p: 36,
    k: 52,
    quality: '3D Fix (9 Sats)'
  },
  {
    id: 'SMP-1046',
    timestamp: '2026-08-30 14:28:44',
    plot: 'North Plot A',
    mission: 'MSN-001',
    coords: [14.6102, 120.9899],
    moisture: 39.8,
    ph: 6.6,
    ec: 1.18,
    salinity: 605,
    n: 28,
    p: 41,
    k: 58,
    quality: '3D Fix (8 Sats)'
  },
  {
    id: 'SMP-1045',
    timestamp: '2026-08-30 13:55:12',
    plot: 'South Plot B',
    mission: 'MSN-002',
    coords: [14.6080, 120.9875],
    moisture: 38.0,
    ph: 5.9,
    ec: 0.95,
    salinity: 480,
    n: 15,
    p: 28,
    k: 35,
    quality: '3D Fix (7 Sats)'
  },
  {
    id: 'SMP-1044',
    timestamp: '2026-08-30 13:52:00',
    plot: 'South Plot B',
    mission: 'MSN-002',
    coords: [14.6084, 120.9879],
    moisture: 36.4,
    ph: 5.8,
    ec: 0.92,
    salinity: 465,
    n: 14,
    p: 26,
    k: 33,
    quality: '3D Fix (8 Sats)'
  },
  {
    id: 'SMP-1043',
    timestamp: '2026-08-30 11:15:30',
    plot: 'UST Field',
    mission: 'MSN-003',
    coords: [14.6092, 120.9885],
    moisture: 48.0,
    ph: 6.7,
    ec: 1.40,
    salinity: 710,
    n: 31,
    p: 45,
    k: 62,
    quality: '3D Fix (9 Sats)'
  }
];

export default function SamplingView() {
  const [selectedPlot, setSelectedPlot] = useState('ALL');
  const [selectedSample, setSelectedSample] = useState(mockSamples[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLiveActive] = useState(true);

  // Filter samples by plot and search
  const filteredSamples = mockSamples.filter((sample) => {
    const matchesPlot = selectedPlot === 'ALL' || sample.plot === selectedPlot;
    const matchesSearch =
      sample.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sample.mission.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sample.plot.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPlot && matchesSearch;
  });

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Sample ID,Timestamp,Plot,Mission,Latitude,Longitude,Moisture(%),pH,EC(dS/m),Salinity(mg/L),Nitrogen,Phosphorus,Potassium,GPS Quality\n'];
    const rows = filteredSamples.map(
      s => `${s.id},${s.timestamp},${s.plot},${s.mission},${s.coords[0]},${s.coords[1]},${s.moisture},${s.ph},${s.ec},${s.salinity},${s.n},${s.p},${s.k},${s.quality}\n`
    );
    const blob = new Blob([...headers, ...rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eksplorador_samples_${selectedPlot.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="sampling-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Banner & Control Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Sampling & Telemetry Inspector</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Real-time RS485 probe captures, GPS tagged coordinates, and raw telemetry log.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Live Ping Indicator */}
          <div
            className="badge badge-connected"
            style={{
              background: '#ecfdf5',
              borderColor: 'var(--primary-green)',
              color: 'var(--primary-green)',
              padding: '6px 12px'
            }}
          >
            <Radio size={14} className={isLiveActive ? 'animate-pulse' : ''} />
            <span>LoRA Live Feed Active</span>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            className="badge"
            style={{
              background: 'var(--primary-green)',
              color: '#fff',
              cursor: 'pointer',
              padding: '8px 14px',
              border: 'none',
              fontWeight: 700
            }}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter and Query Bar */}
      <div
        className="card"
        style={{
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          {/* Search Box */}
          <div style={{ position: 'relative', width: '260px' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search sample, mission, plot..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px 6px 30px',
                borderRadius: '6px',
                border: '1px solid var(--card-border)',
                fontSize: '0.82rem',
                outline: 'none'
              }}
            />
          </div>

          {/* Plot Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} color="var(--text-muted)" />
            <select
              value={selectedPlot}
              onChange={e => setSelectedPlot(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--card-border)',
                fontSize: '0.82rem',
                fontWeight: 600,
                outline: 'none',
                background: '#fff'
              }}
            >
              <option value="ALL">All Fields & Plots</option>
              <option value="UST Field">UST Field</option>
              <option value="North Plot A">North Plot A</option>
              <option value="South Plot B">South Plot B</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filteredSamples.length}</strong> recorded samples
        </div>
      </div>

      {/* Workspace: Table and Mini Location Inspector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.9fr 1.1fr', gap: '14px', flex: 1, minHeight: 0 }}>
        {/* Raw Telemetry Data Table */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">Ingested Sensor Points</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.8rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--card-border)' }}>
                  <th style={{ padding: '8px 10px' }}>Sample ID</th>
                  <th style={{ padding: '8px 10px' }}>Time</th>
                  <th style={{ padding: '8px 10px' }}>Plot</th>
                  <th style={{ padding: '8px 10px' }}>Moist.</th>
                  <th style={{ padding: '8px 10px' }}>pH</th>
                  <th style={{ padding: '8px 10px' }}>EC</th>
                  <th style={{ padding: '8px 10px' }}>N-P-K (mg/kg)</th>
                  <th style={{ padding: '8px 10px' }}>GPS</th>
                </tr>
              </thead>
              <tbody>
                {filteredSamples.map((sample) => {
                  const isSelected = selectedSample?.id === sample.id;
                  return (
                    <tr
                      key={sample.id}
                      onClick={() => setSelectedSample(sample)}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(31, 81, 50, 0.08)' : '#fff',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--primary-green)' }}>
                        {sample.id}
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {sample.timestamp.slice(11)}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                        {sample.plot}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                        {sample.moisture}%
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--earth-light)' }}>
                        {sample.ph}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {sample.ec}
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--earth-dark)' }}>
                        {sample.n} / {sample.p} / {sample.k}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {sample.quality.split(' ')[0]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Sample Detail & Map Sync Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
          {selectedSample ? (
            <>
              {/* Point Inspector Breakdown */}
              <div className="card" style={{ flexShrink: 0 }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="card-title">Telemetry Inspector: {selectedSample.id}</span>
                  <span className="badge" style={{ padding: '2px 8px', fontSize: '0.7rem' }}>{selectedSample.mission}</span>
                </div>

                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    <div style={{ padding: '8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Moisture</div>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary-green)' }}>{selectedSample.moisture}%</div>
                    </div>
                    <div style={{ padding: '8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>pH Level</div>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--earth-light)' }}>{selectedSample.ph}</div>
                    </div>
                    <div style={{ padding: '8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>EC</div>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{selectedSample.ec} <span style={{ fontSize: '0.65rem' }}>dS/m</span></div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
                    <div style={{ padding: '8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Salinity</div>
                      <div style={{ fontWeight: 700 }}>{selectedSample.salinity} mg/L</div>
                    </div>
                    <div style={{ padding: '8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>N-P-K Ratio</div>
                      <div style={{ fontWeight: 700, color: 'var(--earth-dark)' }}>{selectedSample.n} / {selectedSample.p} / {selectedSample.k}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid #f1f5f9', paddingTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>📍 {selectedSample.coords[0].toFixed(5)}° N, {selectedSample.coords[1].toFixed(5)}° E</span>
                    <span>⏱ {selectedSample.timestamp}</span>
                  </div>
                </div>
              </div>

              {/* Geo-tagged Map Sync View */}
              <div className="card" style={{ flex: 1, minHeight: '220px', position: 'relative' }}>
                <div className="card-header">
                  <span className="card-title">Geographical Location</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{selectedSample.plot}</span>
                </div>
                <HeatmapMap
                  center={selectedSample.coords}
                  zoom={19}
                  waypoints={[selectedSample.coords]}
                  roverPos={selectedSample.coords}
                />
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Select a sample point from the table to view geo-coordinates and probe analysis.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}