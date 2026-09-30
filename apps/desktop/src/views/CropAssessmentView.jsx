import React, { useState, useEffect, useMemo } from 'react';
import {
  Sprout,
  Plus,
  Edit2,
  Trash2,
  MapPin,
  Filter,
  X,
  AlertCircle
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import {
  fetchCropProfiles,
  saveCropProfile,
  deleteCropProfile,
  fetchRecordedPlots,
  fetchPlotSamples
} from '../services/db';

// Every soil parameter the rover records that has a crop threshold range.
// `key` is the field on a telemetry sample; `min`/`max` are threshold keys.
const PARAMETERS = [
  { key: 'ph', label: 'pH', unit: '', step: 0.1, min: 'minPh', max: 'maxPh' },
  { key: 'moisture', label: 'Moisture', unit: '%', step: 1, min: 'minMoisture', max: 'maxMoisture' },
  { key: 'ec', label: 'EC', unit: 'dS/m', step: 0.1, min: 'minEC', max: 'maxEC' },
  { key: 'n', label: 'Nitrogen', unit: 'mg/kg', step: 1, min: 'minN', max: 'maxN' },
  { key: 'p', label: 'Phosphorus', unit: 'mg/kg', step: 1, min: 'minP', max: 'maxP' },
  { key: 'k', label: 'Potassium', unit: 'mg/kg', step: 1, min: 'minK', max: 'maxK' }
];

// Heat intensity per sample: 1 = every parameter in range, 0.6 = one out, 0.25 = two or more out.
const SUITABILITY_GRADIENT = {
  0.2: '#dc2626',
  0.6: '#eab308',
  1.0: '#15803d'
};

const emptyForm = {
  id: '',
  name: '',
  category: 'Cereal / Grain',
  minPh: 6.0, maxPh: 7.0,
  minMoisture: 35, maxMoisture: 65,
  minEC: 0.8, maxEC: 2.0,
  minN: 25, maxN: 45,
  minP: 25, maxP: 45,
  minK: 35, maxK: 55,
  notes: ''
};

// Checks one soil sample against a crop's threshold ranges. Parameters the
// sample has no reading for (null / missing) are skipped, not counted as failures.
function evaluateSample(sample, thresholds) {
  const failed = [];
  let checked = 0;

  PARAMETERS.forEach((p) => {
    const raw = sample[p.key];
    const lo = thresholds[p.min];
    const hi = thresholds[p.max];
    if (raw === null || raw === undefined || lo == null || hi == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;

    checked += 1;
    if (value < lo || value > hi) failed.push(p.key);
  });

  return { checked, failed };
}

// Monotone-chain convex hull over [lat, lng] points. Used as the heatmap
// clipping area, because plot boundaries are not stored in the database.
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return [];

  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  pts.forEach((p) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  });

  const upper = [];
  [...pts].reverse().forEach((p) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  });

  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [];
}

// Fallback clipping area for plots whose samples are too few or too
// collinear to form a hull: a small padded box (~15 m) around the samples.
function paddedBox(points, pad = 0.00015) {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const south = Math.min(...lats) - pad;
  const north = Math.max(...lats) + pad;
  const west = Math.min(...lngs) - pad;
  const east = Math.max(...lngs) + pad;
  return [[south, west], [south, east], [north, east], [north, west]];
}

export default function CropAssessmentView() {
  const [crops, setCrops] = useState([]);
  const [plots, setPlots] = useState([]);
  const [selectedCropId, setSelectedCropId] = useState('');
  const [selectedPlot, setSelectedPlot] = useState('');
  const [plotSamples, setPlotSamples] = useState([]);
  const [filterCategory, setFilterCategory] = useState('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [formData, setFormData] = useState(emptyForm);

  // Load crop profiles and recorded plots from the database
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const [cropRows, plotRows] = await Promise.all([fetchCropProfiles(), fetchRecordedPlots()]);
      if (cancelled) return;
      setCrops(cropRows);
      setSelectedCropId(cropRows[0]?.id || '');
      setPlots(plotRows);
      setSelectedPlot(plotRows[0]?.plot || '');
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // Load the soil samples of whichever plot is selected
  useEffect(() => {
    if (!selectedPlot) {
      setPlotSamples([]);
      return undefined;
    }

    let cancelled = false;
    fetchPlotSamples(selectedPlot).then((rows) => {
      if (!cancelled) setPlotSamples(rows);
    });
    return () => { cancelled = true; };
  }, [selectedPlot]);

  const currentCrop = crops.find(c => c.id === selectedCropId) || crops[0];

  const filteredCrops = crops.filter(c => {
    return filterCategory === 'ALL' || c.category === filterCategory;
  });

  // Score every sample of the selected plot against the selected crop.
  // Memoized so the map only re-interpolates when the crop or plot changes.
  const analysis = useMemo(() => {
    if (!currentCrop) return null;

    const evaluated = plotSamples
      .map((s) => ({ sample: s, ...evaluateSample(s, currentCrop.thresholds) }))
      .filter((r) => r.checked > 0 && Number.isFinite(Number(r.sample.lat)) && Number.isFinite(Number(r.sample.lng)));

    const counts = { suitable: 0, marginal: 0, unsuitable: 0 };
    const failureTally = {};

    const heatPoints = evaluated.map(({ sample, failed }) => {
      failed.forEach((key) => { failureTally[key] = (failureTally[key] || 0) + 1; });

      if (failed.length === 0) {
        counts.suitable += 1;
        return [Number(sample.lat), Number(sample.lng), 1];
      }
      if (failed.length === 1) {
        counts.marginal += 1;
        return [Number(sample.lat), Number(sample.lng), 0.6];
      }
      counts.unsuitable += 1;
      return [Number(sample.lat), Number(sample.lng), 0.25];
    });

    const focusPoints = heatPoints.map(([lat, lng]) => [lat, lng]);

    const limiting = PARAMETERS
      .filter((p) => failureTally[p.key])
      .map((p) => ({ label: p.label, count: failureTally[p.key] }))
      .sort((a, b) => b.count - a.count);

    const hull = convexHull(focusPoints);

    return {
      total: evaluated.length,
      counts,
      limiting,
      heatPoints,
      focusPoints,
      boundary: hull.length ? hull : (focusPoints.length ? paddedBox(focusPoints) : [])
    };
  }, [plotSamples, currentCrop]);

  const handleOpenAddModal = () => {
    const nextNumber = Math.max(0, ...crops.map(c => parseInt(c.id.replace(/\D/g, ''), 10) || 0)) + 1;
    setFormData({ ...emptyForm, id: `CRP-${String(nextNumber).padStart(3, '0')}` });
    setIsEditing(false);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (crop) => {
    setFormData({
      id: crop.id,
      name: crop.name,
      category: crop.category,
      notes: crop.notes || '',
      ...crop.thresholds
    });
    setIsEditing(true);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleDeleteCrop = async (cropId) => {
    const ok = await deleteCropProfile(cropId);
    if (!ok) return;

    const updated = crops.filter(c => c.id !== cropId);
    setCrops(updated);
    if (selectedCropId === cropId) {
      setSelectedCropId(updated[0]?.id || '');
    }
  };

  const handleSaveCrop = async () => {
    if (!formData.name.trim()) {
      setModalError('Crop name cannot be empty.');
      return;
    }

    const thresholds = {};
    for (const p of PARAMETERS) {
      const lo = parseFloat(formData[p.min]);
      const hi = parseFloat(formData[p.max]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        setModalError(`${p.label} needs both a min and a max value.`);
        return;
      }
      if (lo >= hi) {
        setModalError(`Min ${p.label} must be lower than Max ${p.label}.`);
        return;
      }
      thresholds[p.min] = lo;
      thresholds[p.max] = hi;
    }

    const entry = {
      id: formData.id,
      name: formData.name.trim(),
      category: formData.category,
      notes: formData.notes.trim(),
      thresholds
    };

    const saved = await saveCropProfile(entry);
    if (!saved) {
      setModalError('Could not save the profile to the database. Please try again.');
      return;
    }

    if (isEditing) {
      setCrops(prev => prev.map(c => (c.id === entry.id ? entry : c)));
    } else {
      setCrops(prev => [...prev, entry]);
      setSelectedCropId(entry.id);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="crop-assessment-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Crop Suitability & Threshold Assessment</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Multi-factor crop viability diagnostics, field area matching, and custom agronomical thresholds.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {/* Category Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} color="var(--text-muted)" />
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
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
              <option value="ALL">All Crop Types</option>
              <option value="Cereal / Grain">Cereal / Grain</option>
              <option value="Root Crop">Root Crop</option>
              <option value="Vegetable">Vegetable</option>
            </select>
          </div>

          <button
            onClick={handleOpenAddModal}
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
            <Plus size={14} /> Add Crop Profile
          </button>
        </div>
      </div>

      {/* Main Grid: Crop Directory & Evaluation Card */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '14px', flex: 1, minHeight: 0 }}>
        {/* Left Column: Crop List */}
        <div className="card" style={{ overflowY: 'auto' }}>
          <div className="card-header">
            <span className="card-title">Assessed Crops Matrix</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredCrops.length} Profiles</span>
          </div>

          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredCrops.map(crop => {
              const isSelected = selectedCropId === crop.id;
              return (
                <div
                  key={crop.id}
                  onClick={() => setSelectedCropId(crop.id)}
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
                  <strong style={{ fontSize: '0.9rem' }}>{crop.name}</strong>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{crop.category}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Crop Detail, Threshold Matrix & Plot Matching */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
          {currentCrop && (
            <>
              {/* Profile Header & Compatibility Overview */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sprout size={16} color="var(--primary-green)" />
                    {currentCrop.name}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => handleOpenEditModal(currentCrop)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                      title="Edit Crop Thresholds"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDeleteCrop(currentCrop.id)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                      title="Delete Crop Profile"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {currentCrop.notes && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{currentCrop.notes}</p>
                  )}

                  {/* Recorded Field Plots (queried from the database) */}
                  <div>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Recorded field plots
                      <span style={{ fontWeight: 500 }}> (select one to map it below)</span>
                    </span>

                    {plots.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        No plots recorded yet. Log soil samples in Field Map to add one.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {plots.map(({ plot, sampleCount }) => {
                          const isActive = plot === selectedPlot;
                          return (
                            <button
                              key={plot}
                              type="button"
                              aria-pressed={isActive}
                              title={`${sampleCount} samples`}
                              onClick={() => setSelectedPlot(plot)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                background: isActive ? 'rgba(31, 81, 50, 0.08)' : 'var(--bg-main)',
                                border: '1px solid',
                                borderColor: isActive ? 'var(--primary-green)' : 'var(--card-border)',
                                color: 'inherit',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              <MapPin size={12} color="var(--primary-green)" />
                              {plot}
                              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{sampleCount}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Threshold Parameters Grid */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Agronomic Threshold Range Rules</span>
                </div>

                <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Target pH Range</span>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--earth-light)' }}>
                      {currentCrop.thresholds.minPh} - {currentCrop.thresholds.maxPh}
                    </div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Target Moisture</span>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--primary-green)' }}>
                      {currentCrop.thresholds.minMoisture}% - {currentCrop.thresholds.maxMoisture}%
                    </div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>EC Tolerance</span>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                      {currentCrop.thresholds.minEC} - {currentCrop.thresholds.maxEC} <span style={{ fontSize: '0.7rem' }}>dS/m</span>
                    </div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Opt. Nitrogen (N)</span>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--earth-dark)' }}>{currentCrop.thresholds.minN} - {currentCrop.thresholds.maxN} mg/kg</div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Opt. Phosphorus (P)</span>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--earth-dark)' }}>{currentCrop.thresholds.minP} - {currentCrop.thresholds.maxP} mg/kg</div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Opt. Potassium (K)</span>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--earth-dark)' }}>{currentCrop.thresholds.minK} - {currentCrop.thresholds.maxK} mg/kg</div>
                  </div>
                </div>
              </div>

              {/* Suitability Heatmap for the selected plot and crop */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="card-title">Field Suitability Heatmap</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {currentCrop.name} on {selectedPlot || 'no plot selected'}
                  </span>
                </div>

                {!analysis || analysis.total === 0 ? (
                  <div style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    {selectedPlot
                      ? `${selectedPlot} has no scored samples yet. Log readings there in Field Map.`
                      : 'Select a plot above to map where it suits this crop.'}
                  </div>
                ) : (
                  <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
                      <strong style={{ fontSize: '0.85rem' }}>
                        {Math.round((analysis.counts.suitable / analysis.total) * 100)}% of {analysis.total} samples are fully suitable
                      </strong>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#dcfce7', color: '#166534', fontWeight: 700 }}>
                        {analysis.counts.suitable} suitable
                      </span>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
                        {analysis.counts.marginal} marginal
                      </span>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                        {analysis.counts.unsuitable} unsuitable
                      </span>
                    </div>

                    <div style={{ position: 'relative', height: '380px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--card-border)' }}>
                      <HeatmapMap
                        heatPoints={analysis.heatPoints}
                        focusPoints={analysis.focusPoints}
                        boundary={analysis.boundary}
                        gradient={SUITABILITY_GRADIENT}
                        showRover={false}
                        showFollowControl={false}
                      />

                      <div style={{
                        position: 'absolute',
                        bottom: '12px',
                        left: '12px',
                        zIndex: 1000,
                        background: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid var(--card-border)',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        fontSize: '0.72rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}>
                        {[
                          { color: '#15803d', label: 'All parameters in range' },
                          { color: '#eab308', label: 'One parameter out of range' },
                          { color: '#dc2626', label: 'Two or more out of range' }
                        ].map((item) => (
                          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: item.color }} />
                            {item.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    {analysis.limiting.length > 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        Most often out of range: {analysis.limiting.map((l) => `${l.label} (${l.count} of ${analysis.total})`).join(', ')}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add / Edit Crop Profile Modal */}
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
            width: '540px',
            maxHeight: '90vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                {isEditing ? 'Edit Crop Profile' : 'Add New Crop Threshold Profile'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {modalError && (
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
                <span>{modalError}</span>
              </div>
            )}

            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Crop Name</label>
              <input
                type="text"
                placeholder="e.g. Sugarcane (Saccharum officinarum)"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Crop Category</label>
              <select
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              >
                <option value="Cereal / Grain">Cereal / Grain</option>
                <option value="Root Crop">Root Crop</option>
                <option value="Vegetable">Vegetable</option>
                <option value="Legume">Legume</option>
              </select>
            </div>

            {/* Threshold Ranges */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {PARAMETERS.map((p) => (
                <div key={p.key}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Min / Max {p.label}{p.unit ? ` (${p.unit})` : ''}
                  </label>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    <input
                      type="number"
                      step={p.step}
                      value={formData[p.min]}
                      onChange={e => setFormData({ ...formData, [p.min]: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                    />
                    <input
                      type="number"
                      step={p.step}
                      value={formData[p.max]}
                      onChange={e => setFormData({ ...formData, [p.max]: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Limiting Factor / Notes</label>
              <textarea
                rows="2"
                placeholder="Optional diagnostic or soil amendment guidelines..."
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px', resize: 'none', fontSize: '0.8rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                className="badge"
                onClick={() => setIsModalOpen(false)}
                style={{ cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                className="badge"
                onClick={handleSaveCrop}
                style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer' }}
              >
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}