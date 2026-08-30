import React, { useState } from 'react';
import {
  Layers,
  Sparkles,
  Calendar,
  Plus,
  TrendingDown,
  TrendingUp,
  Tag,
  FileText,
  Save,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  Filter
} from 'lucide-react';

const mockSoilRecords = [
  {
    id: 'REC-001',
    plot: 'UST Field',
    lastSurvey: '2026-08-30',
    texture: 'Clay Loam',
    textureColor: '#8A5A35',
    healthGrade: 'Grade A - Optimal',
    healthScore: 92,
    avgPh: 6.7,
    avgMoisture: '48.0%',
    avgEC: '1.40 dS/m',
    npkSummary: 'Balanced (High Nitrogen)',
    historicalTrend: {
      moistureDelta: '+4.2% vs last month',
      phDelta: '+0.2 (Stable)',
      ecDelta: '-0.05 dS/m'
    },
    notes: 'Soil shows high moisture retention and healthy organic matter. Ready for next cropping cycle.',
    amendments: [
      { date: '2026-08-15', treatment: 'Organic Compost (200kg)', operator: 'Admin' },
      { date: '2026-07-28', treatment: 'Agricultural Lime (50kg)', operator: 'Admin' }
    ]
  },
  {
    id: 'REC-002',
    plot: 'North Plot A',
    lastSurvey: '2026-08-20',
    texture: 'Loam',
    textureColor: '#1F5132',
    healthGrade: 'Grade A - High Fertility',
    healthScore: 89,
    avgPh: 6.4,
    avgMoisture: '42.5%',
    avgEC: '1.25 dS/m',
    npkSummary: 'Optimal NPK Ratio',
    historicalTrend: {
      moistureDelta: '-1.8% vs last month',
      phDelta: '0.0 (Optimal)',
      ecDelta: '+0.10 dS/m'
    },
    notes: 'Ideal drainage with balanced soil texture. Very favorable for cereal crops.',
    amendments: [
      { date: '2026-08-02', treatment: 'NPK 14-14-14 Fertilizer (80kg)', operator: 'Admin' }
    ]
  },
  {
    id: 'REC-003',
    plot: 'South Plot B',
    lastSurvey: '2026-08-22',
    texture: 'Sandy Loam',
    textureColor: '#D99A2B',
    healthGrade: 'Grade B - Moderate',
    healthScore: 74,
    avgPh: 5.9,
    avgMoisture: '37.2%',
    avgEC: '0.92 dS/m',
    npkSummary: 'Low Potassium (K)',
    historicalTrend: {
      moistureDelta: '-6.5% vs last month',
      phDelta: '-0.3 (Slight Acidification)',
      ecDelta: '-0.15 dS/m'
    },
    notes: 'Fast water percolation observed. Requires potassium enrichment and moisture-retaining mulching.',
    amendments: [
      { date: '2026-08-10', treatment: 'Potash (MOP) Supplement (40kg)', operator: 'Admin' }
    ]
  }
];

export default function SoilRecordsView() {
  const [records, setRecords] = useState(mockSoilRecords);
  const [selectedRecordId, setSelectedRecordId] = useState('REC-001');
  const [filterTexture, setFilterTexture] = useState('ALL');
  const [isAddingAmendment, setIsAddingAmendment] = useState(false);
  const [newTreatment, setNewTreatment] = useState('');

  const currentRecord = records.find(r => r.id === selectedRecordId) || records[0];

  const filteredRecords = records.filter(r => {
    return filterTexture === 'ALL' || r.texture === filterTexture;
  });

  const handleAddAmendment = () => {
    if (!newTreatment.trim()) return;
    const newEntry = {
      date: new Date().toISOString().slice(0, 10),
      treatment: newTreatment.trim(),
      operator: 'Operator'
    };

    setRecords(prev => prev.map(r => {
      if (r.id === currentRecord.id) {
        return { ...r, amendments: [newEntry, ...r.amendments] };
      }
      return r;
    }));

    setNewTreatment('');
    setIsAddingAmendment(false);
  };

  return (
    <div className="soil-records-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Soil Records & Health Profiles</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Consolidated historical soil texture classification, fertility grades, and amendment tracking.
          </p>
        </div>

        {/* Filter Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Filter size={14} color="var(--text-muted)" />
          <select
            value={filterTexture}
            onChange={e => setFilterTexture(e.target.value)}
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
            <option value="ALL">All Soil Textures</option>
            <option value="Loam">Loam</option>
            <option value="Clay Loam">Clay Loam</option>
            <option value="Sandy Loam">Sandy Loam</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Profiles List & Detailed Inspector */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '14px', flex: 1, minHeight: 0 }}>
        {/* Left: Soil Profile Directory */}
        <div className="card" style={{ overflowY: 'auto' }}>
          <div className="card-header">
            <span className="card-title">Field Soil Profiles</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredRecords.length} Plots</span>
          </div>

          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredRecords.map(rec => {
              const isSelected = selectedRecordId === rec.id;
              return (
                <div
                  key={rec.id}
                  onClick={() => setSelectedRecordId(rec.id)}
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
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{rec.plot}</span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: rec.textureColor,
                        color: '#fff'
                      }}
                    >
                      {rec.texture}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <span>Health: <strong style={{ color: 'var(--primary-green)' }}>{rec.healthScore}/100</strong></span>
                    <span>pH: <strong>{rec.avgPh}</strong></span>
                    <span>Moist: <strong>{rec.avgMoisture}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Detailed Soil Profile Breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
          {/* Agronomic Profile & Health Card */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Soil Quality Report: {currentRecord.plot}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Surveyed: {currentRecord.lastSurvey}
              </span>
            </div>

            <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Top Stats Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Texture Type</div>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: currentRecord.textureColor }}>
                    {currentRecord.texture}
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Fertility Grade</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--primary-green)' }}>
                    {currentRecord.healthGrade}
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Mean pH</div>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--earth-light)' }}>
                    {currentRecord.avgPh}
                  </div>
                </div>

                <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Nutrient Balance</div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                    {currentRecord.npkSummary}
                  </div>
                </div>
              </div>

              {/* Historical Drift & Trends */}
              <div style={{ border: '1px solid var(--card-border)', borderRadius: '8px', padding: '12px', background: '#fff' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} color="var(--accent-gold)" />
                  Historical Zone Trends & Variance
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '0.78rem' }}>
                  <div style={{ padding: '6px 10px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Moisture Shift:</span>
                    <div style={{ fontWeight: 700, color: 'var(--primary-green)' }}>{currentRecord.historicalTrend.moistureDelta}</div>
                  </div>
                  <div style={{ padding: '6px 10px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>pH Drift:</span>
                    <div style={{ fontWeight: 700 }}>{currentRecord.historicalTrend.phDelta}</div>
                  </div>
                  <div style={{ padding: '6px 10px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>EC Variance:</span>
                    <div style={{ fontWeight: 700 }}>{currentRecord.historicalTrend.ecDelta}</div>
                  </div>
                </div>
              </div>

              {/* Agronomist Notes */}
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Field Agronomy Notes:</span>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                  {currentRecord.notes}
                </p>
              </div>
            </div>
          </div>

          {/* Soil Treatments & Amendments History */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={15} color="var(--primary-green)" />
                Soil Amendments & Treatment History
              </span>
              <button
                className="badge"
                onClick={() => setIsAddingAmendment(!isAddingAmendment)}
                style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', border: 'none', padding: '4px 10px' }}
              >
                <Plus size={13} /> Add Record
              </button>
            </div>

            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isAddingAmendment && (
                <div style={{ display: 'flex', gap: '8px', padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--card-border)' }}>
                  <input
                    type="text"
                    placeholder="e.g. Organic compost 150kg, Dolomite lime applied..."
                    value={newTreatment}
                    onChange={e => setNewTreatment(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.8rem', outline: 'none' }}
                  />
                  <button
                    onClick={handleAddAmendment}
                    style={{ background: 'var(--primary-green)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Save
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {currentRecord.amendments.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #f1f5f9',
                      background: '#fff',
                      fontSize: '0.8rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle2 size={15} color="var(--primary-green)" />
                      <strong style={{ color: 'var(--text-dark)' }}>{item.treatment}</strong>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {item.date} • Logged by {item.operator}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}