import React, { useCallback, useEffect, useRef, useState } from 'react';
import HelpButton from '../components/ui/HelpButton';
import { getAllTelemetry, fetchFields, fetchCropProfiles, fetchMissions } from '../services/db';
import { processTelemetryToReports } from '../utils/reportSummaries';
import { FileText, Printer, RefreshCw, Calendar, MapPin, Layers, Loader2, AlertCircle, Filter, CheckCircle2 } from 'lucide-react';

const ink = '#263a34';
const muted = '#62756e';
const panel = { background: '#f6f8f5', border: '1px solid #dce7de', borderRadius: '9px' };

function Metric({ label, value }) {
  return (
    <div className="report-metric" style={{ ...panel, padding: '12px', minWidth: 0 }}>
      <div style={{ fontSize: '0.72rem', color: muted, fontWeight: 650 }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: ink, overflowWrap: 'anywhere', marginTop: '5px' }}>{value}</div>
    </div>
  );
}

export default function ReportsView({ onHelp }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [plotFilter, setPlotFilter] = useState('ALL');
  const loadToken = useRef(0);

  const loadReports = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const [rows, fields, cropProfiles, missions] = await Promise.all([
        getAllTelemetry(), fetchFields(), fetchCropProfiles(), fetchMissions()
      ]);
      const processed = processTelemetryToReports(rows, fields, cropProfiles, missions);
      if (loadToken.current !== token) return;
      setReports(processed);
      setSelectedReportId(previous => processed.some(r => r.id === previous) ? previous : (processed[0]?.id || null));
    } catch (err) {
      if (loadToken.current !== token) return;
      console.error('Unable to build Eksplorador field reports:', err);
      setError('Unable to load the report records. Check the database connection and select Refresh to try again.');
    } finally {
      if (loadToken.current === token) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
    return () => { loadToken.current += 1; };
  }, [loadReports]);

  const uniquePlots = [...new Set(reports.map(r => r.plot))].sort((a,b) => a.localeCompare(b));
  const filteredReports = reports.filter(r => plotFilter === 'ALL' || r.plot === plotFilter);
  const currentReport = filteredReports.find(r => r.id === selectedReportId) || filteredReports[0] || null;
  const handlePrint = () => { if (currentReport) window.print(); };

  return (
    <div className="reports-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '14px' }}>
      <style>{`
        .reports-layout { display:grid; grid-template-columns:minmax(220px,280px) minmax(0,1fr); gap:14px; flex:1; min-height:0; }
        .reports-history { min-width:0; overflow-y:auto; }
        .report-paper { min-width:0; overflow-y:auto; padding:24px; background:#fff; color:${ink}; }
        .report-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
        .report-toolbar button,.report-toolbar select { min-height:36px; }
        .report-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
        .report-crop-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
        .report-data-table { width:100%; border-collapse:collapse; font-size:.79rem; text-align:left; }
        .report-data-table th { background:#edf4ee; color:${ink}; font-weight:750; }
        .report-data-table td,.report-data-table th { padding:9px 8px; border-bottom:1px solid #e2e9e3; vertical-align:top; overflow-wrap:anywhere; }
        .report-data-table thead { display:table-header-group; }
        .report-section { margin-bottom:20px; }
        .report-section-title { font-size:.93rem; font-weight:800; margin-bottom:10px; color:#254b35; }
        .report-stat-note { font-size:.75rem; color:${muted}; }
        @media (max-width:1150px) { .report-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:960px) {
          .reports-layout { grid-template-columns:minmax(0,1fr); overflow-y:auto; }
          .reports-history { max-height:190px; overflow-y:auto; }
          .report-paper { overflow-y:visible; }
          .report-crop-grid { grid-template-columns:minmax(0,1fr); }
        }
        @media (max-width:620px) {
          .report-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .report-paper { padding:14px; }
        }
        @media print {
          @page { size:A4 portrait; margin:12mm; }
          html,body,#root { height:auto!important; overflow:visible!important; }
          body * { visibility:hidden!important; }
          .report-paper,.report-paper * { visibility:visible!important; }
          .report-paper { position:absolute!important; left:0!important; top:0!important; width:100%!important;
            max-width:none!important; height:auto!important; overflow:visible!important; margin:0!important; padding:0!important;
            box-shadow:none!important; border:none!important; background:#fff!important; color:#172a21!important; }
          .reports-view,.reports-layout { display:block!important; height:auto!important; overflow:visible!important; }
          .reports-history,.reports-topbar { display:none!important; }
          .report-section { break-inside:auto; page-break-inside:auto; }
          .report-metric,.report-crop-item,.report-document-header { break-inside:avoid-page; page-break-inside:avoid; }
          .report-data-table tr { break-inside:avoid-page; page-break-inside:avoid; }
          .report-data-table thead { display:table-header-group; }
          .report-data-table { font-size:9pt; }
        }
      `}</style>

      <div className="reports-topbar view-header" style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', alignItems:'center', gap:'14px' }}>
        <div>
          <h2 style={{ fontSize:'1.4rem', fontWeight:800, margin:0 }}>Field Soil Monitoring Reports</h2>
          <p style={{ color:'var(--text-muted)', fontSize:'.84rem', marginTop:'4px' }}>
            Reports for saved fields with soil measurements, including field-linked samples without missions.
          </p>
        </div>
        <div className="report-toolbar">
          <HelpButton viewId="Reports" onOpen={onHelp} />
          <Filter size={15} color={muted} />
          <select aria-label="Filter reports by field" value={plotFilter} onChange={e => setPlotFilter(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid var(--card-border)', borderRadius:'6px', background:'#fff', maxWidth:'230px' }}>
            <option value="ALL">All Fields ({uniquePlots.length})</option>
            {uniquePlots.map(plot => <option key={plot} value={plot}>{plot}</option>)}
          </select>
          <button type="button" className="ui-control" onClick={loadReports} disabled={loading}
            style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 12px', border:'1px solid var(--card-border)', borderRadius:7, background:'#fff', cursor:loading?'wait':'pointer' }}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button type="button" className="ui-control" onClick={handlePrint} disabled={!currentReport || loading}
            style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'8px 12px', border:0, borderRadius:7, background:'var(--primary-green)', color:'#fff', fontWeight:750, cursor:currentReport?'pointer':'not-allowed', opacity:currentReport?1:.5 }}>
            <Printer size={15} /> Print / Save as PDF
          </button>
        </div>
      </div>

      {error && <div role="alert" style={{ ...panel, color:'#9f2e25', background:'#fff5f3', padding:'12px', display:'flex', alignItems:'center', gap:9 }}>
        <AlertCircle size={18} /> {error}
      </div>}

      {loading && !reports.length ? (
        <div style={{ display:'flex', flex:1, alignItems:'center', justifyContent:'center', gap:12 }}>
          <Loader2 size={25} className="animate-spin" /> Loading field reports…
        </div>
      ) : (
        <div className="reports-layout">
          <div className="card reports-history">
            <div className="card-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span className="card-title">Report Records</span>
              <span className="report-stat-note">{filteredReports.length} reports</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, padding:12 }}>
              {!filteredReports.length && <div style={{ textAlign:'center', padding:22, color:muted, fontSize:'.85rem' }}>
                {reports.length ? 'No reports match the selected field.' : 'No saved fields with soil measurements yet. Save samples to a field to generate a report.'}
              </div>}
              {filteredReports.map(report => (
                <button key={report.id} type="button" aria-pressed={report.id === currentReport?.id}
                  onClick={() => setSelectedReportId(report.id)}
                  style={{ textAlign:'left', display:'flex', flexDirection:'column', gap:5, padding:12,
                    border:`1px solid ${currentReport?.id===report.id?'var(--primary-green)':'var(--card-border)'}`,
                    borderRadius:9, background:currentReport?.id===report.id?'#eff7ed':'#fff', cursor:'pointer' }}>
                  <strong style={{ fontSize:'.85rem', color:ink }}>{report.plot}</strong>
                  <span style={{ fontSize:'.76rem', color:muted, overflowWrap:'anywhere' }}>{report.id}</span>
                  <span style={{ fontSize:'.73rem', color:muted }}>{report.surveyDate} · {report.stats.samplesCount} samples</span>
                </button>
              ))}
            </div>
          </div>

          {currentReport ? (
            <article className="card report-paper printable-document" aria-label="Field Soil Monitoring Report">
              <header className="report-document-header" style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:14, borderBottom:'2px solid #276342', paddingBottom:16, marginBottom:18 }}>
                <div style={{ flex:'1 1 280px', minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7, fontSize:'.75rem', fontWeight:800, color:'#276342', letterSpacing:'.09em' }}>
                    <FileText size={16} /> EKSPLORADOR
                  </div>
                  <h1 style={{ fontSize:'1.32rem', margin:0, color:ink }}>{currentReport.title}</h1>
                  <div style={{ fontSize:'.78rem', color:muted, lineHeight:1.65, marginTop:7 }}>
                    <div><MapPin size={13} style={{ verticalAlign:'middle', marginRight:4 }} /> <b>Field:</b> {currentReport.plot} · <b>Mission:</b> {currentReport.missionId}</div>
                    <div><Calendar size={13} style={{ verticalAlign:'middle', marginRight:4 }} /> <b>Sampling date(s):</b> {currentReport.surveyDate} · <b>Report generated:</b> {currentReport.generatedDate}</div>
                    <div><Layers size={13} style={{ verticalAlign:'middle', marginRight:4 }} /> <b>Operator-tagged soil:</b> {currentReport.soilTexture}</div>
                  </div>
                </div>
                <div style={{ flex:'0 1 260px', minWidth:0, textAlign:'right' }}>
                  <span style={{ display:'inline-block', background:'#eaf2e9', color:'#315b41', padding:'7px 9px', borderRadius:7, fontSize:'.75rem', fontWeight:750 }}>
                    Soil monitoring summary
                  </span>
                  <div style={{ fontSize:'.74rem', color:muted, marginTop:8, overflowWrap:'anywhere' }}>Report ID: {currentReport.id}</div>
                </div>
              </header>

              <section className="report-section">
                <h3 className="report-section-title">1. Recorded Soil Conditions ({currentReport.stats.samplesCount} samples)</h3>
                <div className="report-metrics">
                  <Metric label="Mean Moisture" value={currentReport.stats.avgMoisture} />
                  <Metric label="Mean Soil pH" value={currentReport.stats.avgPh} />
                  <Metric label="Mean Field EC" value={currentReport.stats.avgEC} />
                  <Metric label="N – P – K (sensor averages)" value={`${currentReport.stats.n} / ${currentReport.stats.p} / ${currentReport.stats.k}`} />
                </div>
              </section>

              <section className="report-section" style={{ ...panel, padding:14 }}>
                <h3 className="report-section-title">2. Measurement Provenance</h3>
                <div className="report-metrics">
                  <Metric label="Session-linked samples" value={currentReport.stats.sessionLinkedCount} />
                  <Metric label="Legacy / unlinked samples" value={currentReport.stats.unlinkedCount} />
                  <Metric label="Geotagged samples" value={currentReport.stats.geotaggedCount} />
                  <Metric label="Distinct recorded coordinates" value={currentReport.stats.locationsCount} />
                </div>
                <p className="report-stat-note" style={{ marginTop:10, marginBottom:0 }}>
                  {currentReport.groupingNote}. Raw packets from five-minute sessions are retained separately and are not counted again as samples. A missing session ID does not prove a particular sampling duration.
                </p>
              </section>

              <section className="report-section">
                <h3 className="report-section-title">3. Recorded Parameter Ranges</h3>
                <div style={{ overflowX:'auto' }}>
                  <table className="report-data-table">
                    <thead><tr>
                      <th>Parameter</th><th>Minimum</th><th>Maximum</th><th>Mean</th><th>Valid / Total</th><th>Interpretation</th>
                    </tr></thead>
                    <tbody>{currentReport.parameterVariance.map(row => (
                      <tr key={row.parameter}><td style={{ fontWeight:700 }}>{row.parameter}</td><td>{row.min}</td><td>{row.max}</td><td style={{ fontWeight:750 }}>{row.mean}</td><td>{row.count}</td><td>{row.status}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <p className="report-stat-note" style={{ marginTop:8 }}>N/A indicates no valid reading; a measured zero remains 0. EC is displayed in dS/m; NPK values are conductivity-derived sensor estimates.</p>
              </section>

              <section className="report-section">
                <h3 className="report-section-title">4. Preliminary Crop Compatibility</h3>
                <p className="report-stat-note" style={{ marginBottom:10 }}>Per-sample pH comparisons use the current crop profiles. Soil-type preferences are checked only when both a field type and a crop reference are configured.</p>
                <div className="report-crop-grid">
                  {currentReport.recommendedCrops.map((crop, i) => (
                    <div className="report-crop-item" key={`${crop.name}-${i}`} style={{ ...panel, padding:12, minWidth:0 }}>
                      <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:8, marginBottom:6 }}>
                        <strong style={{ fontSize:'.86rem', color:ink }}>{crop.name}</strong>
                        <span style={{ color:'#276342', fontSize:'.78rem', fontWeight:750 }}>{crop.match}</span>
                      </div>
                      <p style={{ color:muted, fontSize:'.77rem', lineHeight:1.55, margin:0 }}>{crop.note}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="report-section">
                <h3 className="report-section-title">5. Interpretation and Recommended Follow-Up</h3>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {currentReport.actionableRecommendations.map((line, i) => (
                    <div key={i} style={{ display:'flex', gap:9, fontSize:'.8rem', lineHeight:1.5 }}>
                      <CheckCircle2 size={16} color="#397453" style={{ flexShrink:0, marginTop:1 }} />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="report-section">
                <h3 className="report-section-title">6. Sampling Record Index</h3>
                <p className="report-stat-note" style={{ marginBottom:8 }}>
                  Displaying up to 50 records for on-page review. The SQLite database retains all saved samples and the separate raw reception history.
                </p>
                <div style={{ overflowX:'auto' }}>
                  <table className="report-data-table">
                    <thead><tr><th>Date / Time</th><th>Record type</th><th>pH</th><th>Moisture</th><th>EC</th><th>Location</th></tr></thead>
                    <tbody>{currentReport.sampleDetails.slice(0,50).map((row, index) => (
                      <tr key={row.id ?? index}><td>{row.timestamp}</td><td>{row.source}</td><td>{row.ph}</td><td>{row.moisture}</td><td>{row.ec}</td><td>{row.geotag}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                {currentReport.stats.samplesCount > 50 && <p className="report-stat-note">{currentReport.stats.samplesCount - 50} more records are not shown in this printable overview.</p>}
              </section>

              <footer style={{ borderTop:'1px solid #dce7de', paddingTop:12, display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:10, color:muted, fontSize:'.73rem' }}>
                <span>Eksplorador Desktop · System-generated field soil monitoring report · Not independently certified</span>
                <span>{currentReport.inspector}</span>
              </footer>
            </article>
          ) : (
            <div className="card" style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:24, color:muted }}>
              Select a report to view its measurements.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
