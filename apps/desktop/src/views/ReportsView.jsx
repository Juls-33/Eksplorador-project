import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  Loader2,
  AlertCircle,
  Filter
} from 'lucide-react';

// Helper function to dynamically process raw SQLite telemetry into structured agronomic reports
function processTelemetryToReports(records){
  if (!records || records.length === 0) return [];

  // Group records by plot or mission_id (fallback to 'Main Field' if unassigned)
  const groupedByMission = records.reduce((acc, row) => {
    const mission = row.mission_id || "Unassigned";
    if (!acc[mission]) acc[mission] = [];
    acc[mission].push(row);
    return acc;
  }, {});

  return Object.entries(groupedByMission).map(([missionId,rows], index) => {
    const count = rows.length;

    // FIXED: Derived plotName safely from the first record in the mission group
    const plotName = rows[0]?.plot || `Plot ${index + 1}`;

    // Helper math functions
    const calcStats = (key) => {
      const vals = rows
        .map((r) => r[key])
        .filter((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
        .map((v) => Number(v));

      if (vals.length === 0) return { min: 0, max: 0, mean: 0 };
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { min, max, mean };
    };

    const moisture = calcStats('moisture');
    const ph = calcStats('ph');
    const ec = calcStats('ec');
    const n = calcStats('nitrogen');
    const p = calcStats('phosphorus');
    const k = calcStats('potassium');

    // Dynamic Fertility Rating logic based on pH and NPK
    let score = 70;
    if (ph.mean >= 6.0 && ph.mean <= 7.0) score += 15;
    if (moisture.mean >= 30 && moisture.mean <= 60) score += 10;
    if (n.mean >= 20 && p.mean >= 20 && k.mean >= 30) score += 5;

    let grade = 'Grade B - Moderate Fertility';
    if (score >= 85) grade = 'Grade A - Optimal Fertility';
    else if (score < 65) grade = 'Grade C - Low Fertility / Needs Amendment';

    // Dynamic Crop Recommendations
    const crops = [];
    if (ph.mean >= 5.5 && ph.mean <= 6.8 && moisture.mean >= 35) {
      crops.push({ name: 'Rice (Oryza sativa)', match: '92%', note: 'Favorable moisture and pH profile.' });
    }
    if (ph.mean >= 5.8 && ph.mean <= 7.2) {
      crops.push({ name: 'Corn / Maize (Zea mays)', match: '85%', note: 'Balanced pH level across tested nodes.' });
    }
    if (crops.length === 0) {
      crops.push({ name: 'Cassava / Root Crops', match: '70%', note: 'Tolerant to wider soil pH and lower moisture.' });
    }

    const recs = [];
    if (ph.mean < 6.0) recs.push(`Broadcast agricultural lime to elevate soil pH (current mean: ${ph.mean.toFixed(1)}).`);
    else if (ph.mean > 7.5) recs.push(`Apply sulfur amendments to reduce alkalinity (current mean: ${ph.mean.toFixed(1)}).`);
    else recs.push(`Soil pH buffering is stable at ${ph.mean.toFixed(1)}. No lime amendment needed.`);

    if (n.mean < 20) recs.push(`Apply Nitrogen fertilizer (Urea / Ammonium Nitrate) to reach optimal vegetative growth levels.`);
    if (k.mean < 30) recs.push(`Incorporate Muriate of Potash (MOP) to resolve Potassium deficiency.`);
    if (moisture.mean < 30) recs.push(`Increase irrigation volume; average soil moisture is below recommended target.`);

    const reportId = `RPT-2026-00${index + 1}`;
    const latestDate = rows[0]?.timestamp ? rows[0].timestamp.split(' ')[0] : '2026-09-10';

    return {
      id: reportId,
      title: `Agronomic Spatial Assessment: ${plotName}`,
      missionId: rows[0]?.mission_id || `MSN-00${index + 1}`,
      plot: plotName,
      surveyDate: latestDate,
      generatedDate: new Date().toISOString().split('T')[0],
      inspector: 'System Generated (SQLite Data)',
      soilTexture: 'Loam / Field Sample',
      fertilityGrade: grade,
      overallScore: score,
      stats: {
        avgMoisture: `${moisture.mean.toFixed(1)}%`,
        avgPh: ph.mean.toFixed(1),
        avgEC: `${ec.mean.toFixed(2)} dS/m`,
        n: `${n.mean.toFixed(0)} mg/kg`,
        p: `${p.mean.toFixed(0)} mg/kg`,
        k: `${k.mean.toFixed(0)} mg/kg`,
        samplesCount: count
      },
      parameterVariance: [
        { parameter: 'Soil Moisture', min: `${moisture.min.toFixed(1)}%`, max: `${moisture.max.toFixed(1)}%`, mean: `${moisture.mean.toFixed(1)}%`, status: moisture.mean >= 35 ? 'Balanced' : 'Low' },
        { parameter: 'Soil pH', min: ph.min.toFixed(1), max: ph.max.toFixed(1), mean: ph.mean.toFixed(1), status: ph.mean >= 6.0 && ph.mean <= 7.0 ? 'Optimal' : 'Needs Review' },
        { parameter: 'Electrical Conductivity', min: `${ec.min.toFixed(2)} dS/m`, max: `${ec.max.toFixed(2)} dS/m`, mean: `${ec.mean.toFixed(2)} dS/m`, status: 'Normal' },
        { parameter: 'Nitrogen (N)', min: `${n.min.toFixed(0)} mg/kg`, max: `${n.max.toFixed(0)} mg/kg`, mean: `${n.mean.toFixed(0)} mg/kg`, status: n.mean >= 20 ? 'Adequate' : 'Deficient' },
        { parameter: 'Phosphorus (P)', min: `${p.min.toFixed(0)} mg/kg`, max: `${p.max.toFixed(0)} mg/kg`, mean: `${p.mean.toFixed(0)} mg/kg`, status: p.mean >= 20 ? 'Optimal' : 'Low' },
        { parameter: 'Potassium (K)', min: `${k.min.toFixed(0)} mg/kg`, max: `${k.max.toFixed(0)} mg/kg`, mean: `${k.mean.toFixed(0)} mg/kg`, status: k.mean >= 30 ? 'Adequate' : 'Deficient' }
      ], 
      recommendedCrops: crops,
      actionableRecommendations: recs
    };
  });
}

export default function ReportsView() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [plotFilter, setPlotFilter] = useState('ALL');
  const printRef = useRef(null);

  useEffect(() => {
    async function loadDbReports() {
      try {
        setLoading(true);
        await invoke('init_db');
        const rawData = await invoke('get_all_telemetry');
        // Ensure payload is an array regardless of wrapper
        const telemtryRows = Array.isArray(rawData) ? rawData : (rawData?.rows || rawData?.data || []);
        console.log('Raw SQLite output from Tauri:', telemtryRows);

        const processed = processTelemetryToReports(telemtryRows);
        setReports(processed);
        if (processed.length > 0) {
          setSelectedReportId(processed[0].id)
        }
    } catch (err) {
      console.error('Failed to load DB telemetry for reports:', err);
      setError('Failed to fetch report records from SQLite database.');
    } finally {
      setLoading(false);
    }
  }

  loadDbReports();
}, []);

  const uniquePlots = Array.from(new Set(reports.map((r) => r.plot)));
  const filteredReports = reports.filter(r => plotFilter === 'ALL' || r.plot === plotFilter);
  const currentReport = filteredReports.find((r) => r.id === selectedReportId) || filteredReports[0] || reports[0];

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
        <Loader2 className="animate-spin" size={24} color="var(--primary-green)" />
        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Processing Database Telemetry Records...</span>
      </div>
    );
  }

  if (error || reports.length === 0) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center', margin: 'auto', maxWidth: '500px' }}>
        <AlertCircle size={40} color="#b45309" style={{ marginBottom: '12px' }} />
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px' }}>No Database Telemetry Available</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No recorded field samples were found in SQLite. Save telemetry records to view automatically generated agronomic summaries.
        </p>
      </div>
    );
  }

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
              <option value="ALL">All Plots ({reports.length})</option>
              {uniquePlots.map((plot) => (
                <option key = {plot} value={plot}>{plot}</option>
              ))}
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
            {/* THIS IS THE LOOP THAT RENDERS EACH SIDEBAR CARD */}
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
        {currentReport && (
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
              1. Spatial Telemetry & Aggregate Averages ({currentReport.stats.samplesCount} Waypoints)
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
              2. Parameter Range & Deviation Analysis
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
                {currentReport.parameterVariance.map((row, i) => {
                  const isOptimal = ['Optimal', 'Balanced', 'Adequate', 'Normal'].includes(row.status);
                  return (
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
                          background: isOptimal ? '#dcfce7' : '#fef3f7',
                          color: isOptimal ? '#166534' : 'var(--text-muted)'
                        }}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
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
        )}
      </div>
    </div>
  );
}