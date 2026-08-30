import React, { useState, useRef } from 'react';
import {
  FileText,
  Printer,
  Download,
  Calendar,
  MapPin,
  CheckCircle2,
  TrendingUp,
  BarChart2,
  PieChart,
  Layers,
  Award,
  Filter
} from 'lucide-react';

const mockReportData = [
  {
    id: 'RPT-2026-001',
    title: 'Comprehensive Agronomic Survey: North Plot A',
    missionId: 'MSN-001',
    plot: 'North Plot A',
    surveyDate: '2026-08-20',
    generatedDate: '2026-08-30',
    inspector: 'Julius Santos',
    soilTexture: 'Loam',
    fertilityGrade: 'Grade A - Optimal Fertility',
    overallScore: 91,
    stats: {
      avgMoisture: '42.5%',
      avgPh: 6.4,
      avgEC: '1.25 dS/m',
      salinity: '640 mg/L',
      n: '24 mg/kg',
      p: '38 mg/kg',
      k: '55 mg/kg',
      totalDistance: '124m',
      samplesCount: 18
    },
    parameterVariance: [
      { parameter: 'Soil Moisture', min: '38.2%', max: '46.1%', mean: '42.5%', status: 'Balanced' },
      { parameter: 'Soil pH', min: '6.1', max: '6.7', mean: '6.4', status: 'Optimal' },
      { parameter: 'Electrical Conductivity', min: '1.10 dS/m', max: '1.38 dS/m', mean: '1.25 dS/m', status: 'Normal' },
      { parameter: 'Nitrogen (N)', min: '20 mg/kg', max: '28 mg/kg', mean: '24 mg/kg', status: 'Adequate' },
      { parameter: 'Phosphorus (P)', min: '32 mg/kg', max: '44 mg/kg', mean: '38 mg/kg', status: 'Optimal' },
      { parameter: 'Potassium (K)', min: '48 mg/kg', max: '62 mg/kg', mean: '55 mg/kg', status: 'High' }
    ],
    recommendedCrops: [
      { name: 'Rice (Oryza sativa)', match: '94%', note: 'Optimal soil moisture and pH match.' },
      { name: 'Sweet Corn (Zea mays)', match: '88%', note: 'Adequate drainage across northeast grid.' }
    ],
    actionableRecommendations: [
      'Maintain existing irrigation schedule; soil shows consistent moisture retention above 40%.',
      'Apply light nitrogen top-dressing (approx. 20kg/ha Urea) prior to vegetative crop growth stage.',
      'No lime or pH amendment needed. Soil buffering is currently stable at 6.4.'
    ]
  },
  {
    id: 'RPT-2026-002',
    title: 'Nutrient & Moisture Assessment: South Plot B',
    missionId: 'MSN-002',
    plot: 'South Plot B',
    surveyDate: '2026-08-22',
    generatedDate: '2026-08-30',
    inspector: 'Julius Santos',
    soilTexture: 'Sandy Loam',
    fertilityGrade: 'Grade B - Moderate Fertility',
    overallScore: 74,
    stats: {
      avgMoisture: '37.2%',
      avgPh: 5.9,
      avgEC: '0.92 dS/m',
      salinity: '465 mg/L',
      n: '14 mg/kg',
      p: '26 mg/kg',
      k: '33 mg/kg',
      totalDistance: '86m',
      samplesCount: 12
    },
    parameterVariance: [
      { parameter: 'Soil Moisture', min: '34.0%', max: '39.5%', mean: '37.2%', status: 'Low-Normal' },
      { parameter: 'Soil pH', min: '5.6', max: '6.1', mean: '5.9', status: 'Slight Acid' },
      { parameter: 'Electrical Conductivity', min: '0.85 dS/m', max: '1.02 dS/m', mean: '0.92 dS/m', status: 'Low' },
      { parameter: 'Nitrogen (N)', min: '12 mg/kg', max: '16 mg/kg', mean: '14 mg/kg', status: 'Deficient' },
      { parameter: 'Phosphorus (P)', min: '22 mg/kg', max: '30 mg/kg', mean: '26 mg/kg', status: 'Moderate' },
      { parameter: 'Potassium (K)', min: '28 mg/kg', max: '36 mg/kg', mean: '33 mg/kg', status: 'Deficient' }
    ],
    recommendedCrops: [
      { name: 'Cassava / Tuber', match: '65%', note: 'Tolerant to lower pH and sandy loam drainage.' },
      { name: 'Peanut / Legumes', match: '72%', note: 'Assists in natural nitrogen fixation.' }
    ],
    actionableRecommendations: [
      'Apply Muriate of Potash (MOP) to address potassium deficiency (K < 35 mg/kg).',
      'Incorporate organic mulching to reduce rapid water percolation in sandy loam zones.',
      'Broadcast 50kg agricultural dolomite lime to raise pH from 5.9 to 6.5.'
    ]
  }
];

export default function ReportsView() {
  const [selectedReportId, setSelectedReportId] = useState('RPT-2026-001');
  const [plotFilter, setPlotFilter] = useState('ALL');
  const printRef = useRef(null);

  const currentReport = mockReportData.find(r => r.id === selectedReportId) || mockReportData[0];

  const filteredReports = mockReportData.filter(r => {
    return plotFilter === 'ALL' || r.plot === plotFilter;
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="reports-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Banner & Print Actions */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Agronomic Field Reports</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Comprehensive executive summaries, telemetry variance analytics, and printable field documentation.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {/* Plot Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} color="var(--text-muted)" />
            <select
              value={plotFilter}
              onChange={e => setPlotFilter(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--card-border)',
                fontSize: '0.82rem',
                fontWeight: 600,
                background: '#fff',
                outline: 'none'
              }}
            >
              <option value="ALL">All Plots</option>
              <option value="North Plot A">North Plot A</option>
              <option value="South Plot B">South Plot B</option>
            </select>
          </div>

          <button
            onClick={handlePrint}
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
            <Printer size={14} /> Print / Export PDF
          </button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '14px', flex: 1, minHeight: 0 }}>
        {/* Left: Report History Index */}
        <div className="card no-print" style={{ overflowY: 'auto' }}>
          <div className="card-header">
            <span className="card-title">Generated Reports</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredReports.length} Docs</span>
          </div>

          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredReports.map(report => {
              const isSelected = selectedReportId === report.id;
              return (
                <div
                  key={report.id}
                  onClick={() => setSelectedReportId(report.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: isSelected ? 'var(--primary-green)' : 'var(--card-border)',
                    background: isSelected ? 'rgba(31, 81, 50, 0.05)' : '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.85rem' }}>{report.plot}</strong>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: report.overallScore >= 80 ? '#dcfce7' : '#fef3c7',
                      color: report.overallScore >= 80 ? '#166534' : '#92400e'
                    }}>
                      {report.overallScore}/100
                    </span>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dark)', fontWeight: 600 }}>
                    {report.title}
                  </div>

                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{report.id}</span>
                    <span>{report.surveyDate}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Printable Comprehensive Document View */}
        <div className="card printable-document" ref={printRef} style={{ overflowY: 'auto', padding: '24px', background: '#fff' }}>
          {/* Document Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '2px solid var(--primary-green)',
            paddingBottom: '16px',
            marginBottom: '16px'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--primary-green)', letterSpacing: '0.05em' }}>
                  EKSPLORADOR
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-gold)', textTransform: 'uppercase' }}>
                  Soil Spatial Intelligence
                </span>
              </div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-dark)' }}>{currentReport.title}</h1>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '12px' }}>
                <span><strong>Field:</strong> {currentReport.plot}</span>
                <span><strong>Mission:</strong> {currentReport.missionId}</span>
                <span><strong>Survey Date:</strong> {currentReport.surveyDate}</span>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{
                background: currentReport.overallScore >= 80 ? '#dcfce7' : '#fef3c7',
                color: currentReport.overallScore >= 80 ? '#166534' : '#92400e',
                padding: '6px 14px',
                borderRadius: '8px',
                display: 'inline-block',
                fontWeight: 800,
                fontSize: '0.9rem'
              }}>
                {currentReport.fertilityGrade}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Report ID: {currentReport.id}
              </div>
            </div>
          </div>

          {/* Section 1: Executive KPI Summary */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--primary-dark)', marginBottom: '10px' }}>
              1. Spatial Telemetry & Aggregate Averages
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--card-border)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Mean Moisture</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--primary-green)' }}>{currentReport.stats.avgMoisture}</div>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--card-border)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Mean Soil pH</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--earth-light)' }}>{currentReport.stats.avgPh}</div>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--card-border)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Conductivity (EC)</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{currentReport.stats.avgEC}</div>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--card-border)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>N - P - K Averages</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--earth-dark)' }}>
                  {currentReport.stats.n} / {currentReport.stats.p} / {currentReport.stats.k}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Sensor Variance Table */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--primary-dark)', marginBottom: '8px' }}>
              2. Parameter Range & Deviation Analysis ({currentReport.stats.samplesCount} Waypoints)
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: 'var(--text-muted)', borderBottom: '1px solid var(--card-border)' }}>
                  <th style={{ padding: '8px 10px' }}>Soil Parameter</th>
                  <th style={{ padding: '8px 10px' }}>Min Recorded</th>
                  <th style={{ padding: '8px 10px' }}>Max Recorded</th>
                  <th style={{ padding: '8px 10px' }}>Mean Average</th>
                  <th style={{ padding: '8px 10px' }}>Status Rating</th>
                </tr>
              </thead>
              <tbody>
                {currentReport.parameterVariance.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.parameter}</td>
                    <td style={{ padding: '8px 10px' }}>{row.min}</td>
                    <td style={{ padding: '8px 10px' }}>{row.max}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--primary-green)' }}>{row.mean}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: row.status === 'Optimal' || row.status === 'Balanced' ? '#dcfce7' : '#f1f5f9',
                        color: row.status === 'Optimal' || row.status === 'Balanced' ? '#166534' : 'var(--text-muted)'
                      }}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Section 3: Recommended Crops & Suitability Match */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--primary-dark)', marginBottom: '8px' }}>
              3. Agronomical Crop Suitability Forecast
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {currentReport.recommendedCrops.map((crop, i) => (
                <div key={i} style={{ padding: '10px', border: '1px solid var(--card-border)', borderRadius: '6px', background: 'var(--bg-main)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '0.85rem' }}>{crop.name}</strong>
                    <span style={{ color: 'var(--primary-green)', fontWeight: 800, fontSize: '0.8rem' }}>{crop.match} Viable</span>
                  </div>
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{crop.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Actionable Recommendations */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--primary-dark)', marginBottom: '8px' }}>
              4. Prescriptive Action Plan & Field Amendments
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {currentReport.actionableRecommendations.map((action, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.82rem' }}>
                  <CheckCircle2 size={16} color="var(--primary-green)" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Document Sign-off Footer */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderTop: '1px solid var(--card-border)',
            paddingTop: '16px',
            fontSize: '0.75rem',
            color: 'var(--text-muted)'
          }}>
            <div>
              <div>System: Eksplorador Desktop v1.0</div>
              <div>Certified Autonomous Spatial Survey</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ borderBottom: '1px solid var(--text-dark)', width: '160px', marginBottom: '4px' }} />
              <div>Evaluated by: <strong>{currentReport.inspector}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}