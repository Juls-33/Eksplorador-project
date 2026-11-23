import React, { useState, useEffect, useMemo } from 'react';
import {
  Sprout,
  Plus,
  Edit2,
  Trash2,
  MapPin,
  Filter,
  X,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import HelpButton from '../components/ui/HelpButton';
import {
  fetchCropProfiles,
  saveCropProfile,
  deleteCropProfile,
  fetchRecordedPlots,
  fetchPlotSamples,
  fetchFields
} from '../services/db';
import { ecDsM, estimatedTdsMgL } from '../utils/soilSampling';
import { summarizeCropCompatibility } from '../utils/cropCompatibility';
import { BUILTIN_CROP_REFERENCES } from '../utils/cropReferences';
import { PH_LAYER } from '../utils/layerBands';
import { cropPhHeatPoints, cropPhFieldBoundary, CROP_PH_HEATMAP_SETTINGS } from '../utils/cropPhHeatmap';
import './CropAssessmentView.css';

// Legacy crop profile reference ranges remain editable, but only measured pH
// and manually configured soil-type compatibility contribute to the crop score.
// EC/NPK are displayed as monitoring/advisory outputs, not nutrient diagnoses.
const SOIL_TYPES = [
  ['sandy','Sandy'], ['sandy-loam','Sandy loam'], ['loam','Loam'],
  ['clay-loam','Clay loam'], ['clay','Clay'], ['silt-loam','Silt loam']
];

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
  notes: '', compatibleSoilTypes: []
};

export default function CropAssessmentView({ onHelp }) {
  const [crops, setCrops] = useState([]);
  const [plots, setPlots] = useState([]);
  const [knownFields, setKnownFields] = useState([]);
  const [selectedCropId, setSelectedCropId] = useState('');
  const [selectedPlot, setSelectedPlot] = useState('');
  const [plotSamples, setPlotSamples] = useState([]);
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [showPhHeatmap, setShowPhHeatmap] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [formData, setFormData] = useState(emptyForm);

  // Load crop profiles and recorded plots from the database
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const [cropRows, plotRows, fieldRows] = await Promise.all([fetchCropProfiles(), fetchRecordedPlots(), fetchFields()]);
      if (cancelled) return;
      setCrops(cropRows);
      setKnownFields(fieldRows);
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
  const selectedSoilType = knownFields.find(f => f.name === selectedPlot)?.soilType || '';
  const soilTypeLabel = SOIL_TYPES.find(([value])=>value === selectedSoilType)?.[1] || 'Not classified';
  const conditionSummary = useMemo(() => {
    const valid = plotSamples.filter(s => Number.isFinite(Number(s.ec)) && s.ec !== null);
    if (!valid.length) return null;
    const ec = valid.reduce((total, s) => total + Number(s.ec), 0) / valid.length;
    const npkAvg = key => {
      const vals = valid.map(s => s[key]).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
      return vals.length ? vals.reduce((a,b) => a+b,0)/vals.length : null;
    };
    return { ec, n: npkAvg('n'), p: npkAvg('p'), k: npkAvg('k') };
  }, [plotSamples]);

  // Reuse Field Map's measured-pH gradient and bounded IDW renderer.
  // A heatmap is not a continuous crop suitability classification.
  const phHeatPoints = useMemo(() => cropPhHeatPoints(plotSamples), [plotSamples]);
  const phMapBoundary = useMemo(() => cropPhFieldBoundary(knownFields, selectedPlot), [knownFields, selectedPlot]);

  const filteredCrops = crops.filter(c => {
    return filterCategory === 'ALL' || c.category === filterCategory;
  });

  // Evaluate each geotagged sample independently. Compatibility is categorical,
  // so we show actual sampling pins rather than interpolating arbitrary grades.
  const analysis = useMemo(() => {
    if (!currentCrop) return null;
    const located = plotSamples.filter(s => Number.isFinite(Number(s.lat)) &&
      Number.isFinite(Number(s.lng)) && s.lat !== null && s.lng !== null &&
      Number(s.lat) !== 0 && Number(s.lng) !== 0);
    const { evaluated, counts } = summarizeCropCompatibility(
      located, currentCrop.thresholds, selectedSoilType,
      currentCrop.compatibleSoilTypes || []
    );
    const markers = evaluated.map(({ sample, criteria, status }, index) => ({
      lat: Number(sample.lat), lng: Number(sample.lng),
      label: String(index + 1), statusTone: status,
      statusTitle: `Sample ${index + 1}: pH ${criteria.ph.value ?? 'unavailable'} · ${status === 'matched' ? 'Preferences match' : status === 'review' ? 'Review conditions' : 'Insufficient pH data'}`,
      locationSource: sample.location_source || 'GPS'
    }));
    const focusPoints = markers.map(({lat,lng}) => [lat,lng]);
    return { evaluated, counts, markers, focusPoints, total: evaluated.length };
  }, [plotSamples, currentCrop, selectedSoilType]);

  const handleOpenAddModal = () => {
    const nextNumber = Math.max(0, ...crops.map(c => parseInt(c.id.replace(/\D/g, ''), 10) || 0)) + 1;
    setFormData({ ...emptyForm, compatibleSoilTypes: [], id: `CRP-${String(nextNumber).padStart(3, '0')}` });
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
      compatibleSoilTypes: crop.compatibleSoilTypes || [],
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
      compatibleSoilTypes: formData.compatibleSoilTypes || [],
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
    <div className="crop-assessment-view">
      {/* Header Bar */}
      <div className="view-header crop-assessment-header">
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Preliminary Crop Compatibility</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            pH-based compatibility screening with operator-tagged soil type; EC and NPK are advisory sensor indicators, not laboratory nutrient tests.
          </p>
        </div>

        <div className="view-header-actions crop-assessment-actions">
          <HelpButton viewId="Crop Assessment" onOpen={onHelp} />
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
              <option value="Tree Crop">Tree Crop</option>
              <option value="Legume">Legume</option>
            </select>
          </div>

          <button
            onClick={handleOpenAddModal}
            className="badge ui-control"
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
      <div className="crop-assessment-layout">
        {/* Left Column: Crop List */}
        <div className="card crop-directory-card">
          <div className="card-header">
            <span className="card-title">Assessed Crops Matrix</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{filteredCrops.length} Profiles</span>
          </div>

          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredCrops.map(crop => {
              const isSelected = selectedCropId === crop.id;
              return (
                <button
                  type="button"
                  className="ui-selectable-card"
                  aria-pressed={isSelected}
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
                    gap: '6px'
                  }}
                >
                  <strong style={{ fontSize: '0.9rem' }}>{crop.name}</strong>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{crop.category}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Crop Detail, Threshold Matrix & Plot Matching */}
        <div className="crop-assessment-details">
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

              {/* Only the two assessed properties are presented as crop requirements.
                  EC, moisture and NPK are sensor context; their old arbitrary
                  profile numbers are not defensible crop sufficiency thresholds. */}
              <div className="card">
                <div className="card-header"><span className="card-title">Crop Requirements Used in Screening</span></div>
                <div className="crop-reference-grid">
                  <div className="crop-reference-tile">
                    <span className="crop-reference-label">Preferred soil pH</span>
                    <strong>{currentCrop.thresholds.minPh}–{currentCrop.thresholds.maxPh}</strong>
                    <small>Outside this range is flagged for review, not automatic rejection.</small>
                  </div>
                  <div className="crop-reference-tile">
                    <span className="crop-reference-label">Preferred soil textures</span>
                    <strong className="crop-reference-soils">{(currentCrop.compatibleSoilTypes || []).length
                      ? currentCrop.compatibleSoilTypes.map(t => SOIL_TYPES.find(([v]) => v === t)?.[1] || t).join(', ')
                      : 'Not scored'}</strong>
                    <small>Manually classified by the operator at field level.</small>
                  </div>
                  <div className="crop-reference-tile">
                    <span className="crop-reference-label">Assessment method</span>
                    <strong>Rule-based</strong>
                    <small>Per-sample pH and preferred texture check; no fertilizer or yield prediction.</small>
                  </div>
                </div>
                {BUILTIN_CROP_REFERENCES[currentCrop.id] && <p className="crop-reference-citation">
                  Reference: <a href={BUILTIN_CROP_REFERENCES[currentCrop.id].url} target="_blank" rel="noopener noreferrer">
                    {BUILTIN_CROP_REFERENCES[currentCrop.id].source}
                  </a>. {BUILTIN_CROP_REFERENCES[currentCrop.id].note}
                  <span> Crop profile values remain operator-editable; edited thresholds may differ from the cited defaults.</span>
                </p>}
              </div>

              <div className="card crop-field-context-card">
                <div className="crop-field-context-topline">
                  <h3 className="crop-field-context-heading">Field Soil Context</h3>
                  <div className="crop-field-context-type">
                    <span>Operator-tagged soil type</span>
                    <strong>{soilTypeLabel}</strong>
                  </div>
                </div>
                <p className="crop-field-context-note">
                  {selectedSoilType
                    ? (currentCrop?.compatibleSoilTypes?.length
                      ? `Preferred soil types: ${currentCrop.compatibleSoilTypes.map(t => SOIL_TYPES.find(([v]) => v === t)?.[1] || t).join(', ')}.`
                      : 'No crop-specific soil-type range is configured; this field tag is not scored.')
                    : 'Set the field soil type in Field Map to include texture in the screening.'}
                </p>
                {conditionSummary && (
                  <section className="crop-sensor-advisory" aria-label="Field sensor advisory">
                    <div className="crop-sensor-advisory-heading">
                      <h4>Field sensor indicators</h4>
                      <span className="crop-sensor-advisory-badge">Advisory only</span>
                    </div>
                    <div className="crop-sensor-metrics">
                      <div className="crop-sensor-metric">
                        <span className="crop-sensor-metric-label">Mean EC</span>
                        <strong>{ecDsM(conditionSummary.ec)?.toFixed(3)} <small>dS/m</small></strong>
                      </div>
                      <div className="crop-sensor-metric">
                        <span className="crop-sensor-metric-label">Estimated TDS</span>
                        <strong>{estimatedTdsMgL(conditionSummary.ec)?.toFixed(1)} <small>mg/L</small></strong>
                      </div>
                      <div className="crop-sensor-metric">
                        <span className="crop-sensor-metric-label">Mean sensor N / P / K</span>
                        <strong>{['n','p','k'].map(k => conditionSummary[k]?.toFixed(1) ?? '—').join(' / ')} <small>mg/kg</small></strong>
                      </div>
                    </div>
                    <p className="crop-sensor-advisory-caution">
                      <strong>Sensor estimates only.</strong> Confirm with lab soil testing before fertilizer advice.
                    </p>
                    <details className="crop-sensor-advisory-details">
                      <summary>Reading limitations</summary>
                      <p>EC/TDS do not provide laboratory ECe/salinity classification; sensor NPK is uncalibrated and moisture-sensitive.</p>
                    </details>
                  </section>
                )}
              </div>

              {/* Crop screening stays attached to actual measured sample pins.
                  Only the underlying numerical pH is interpolated for display. */}
              <div className="card crop-compatibility-card">
                <div className="card-header crop-compatibility-heading">
                  <span className="card-title">Sample-Level Crop Compatibility</span>
                  <span className="crop-compact-caption">{currentCrop.name} · {selectedPlot || 'No field selected'}</span>
                </div>
                {!analysis || analysis.total === 0 ? (
                  <p className="crop-empty-message">{selectedPlot
                    ? `${selectedPlot} has no geotagged samples to evaluate.`
                    : 'Select a recorded field to evaluate sample points.'}</p>
                ) : (
                  <div className="crop-compatibility-body">
                    <p className="crop-disclaimer">Colored pins show sample-level crop screening. The optional gradient estimates soil pH near measured points, not crop suitability across the field.</p>
                    <div className="crop-stat-row">
                      <span><b>{analysis.counts.phMatched}/{analysis.total}</b> within preferred pH</span>
                      <span><b>{analysis.counts.matched}</b> assessed preferences match</span>
                      <span><b>{analysis.counts.review}</b> require review</span>
                      <span><b>{analysis.counts.insufficient}</b> insufficient pH</span>
                    </div>
                    <div className="crop-ph-toolbar">
                      <div className="crop-ph-toolbar-title">
                        <strong>Soil pH gradient</strong>
                        <span>Measured points + local spatial estimates</span>
                      </div>
                      <button
                        type="button"
                        className="crop-ph-toggle ui-control"
                        onClick={() => setShowPhHeatmap(shown => !shown)}
                        aria-pressed={showPhHeatmap}
                        aria-label={phHeatPoints.length === 0 ? 'No valid pH measurements for heatmap' : showPhHeatmap ? 'Hide soil pH gradient' : 'Show soil pH gradient'}
                        disabled={phHeatPoints.length === 0}
                      >
                        {showPhHeatmap ? <EyeOff size={15} /> : <Eye size={15} />}
                        {phHeatPoints.length === 0 ? 'No pH data' : showPhHeatmap ? 'Hide gradient' : 'Show gradient'}
                      </button>
                    </div>
                    <div className="crop-compatibility-map">
                      <HeatmapMap
                        heatPoints={showPhHeatmap ? phHeatPoints : []}
                        focusPoints={analysis.focusPoints}
                        labeledPoints={analysis.markers}
                        boundary={phMapBoundary}
                        valueToIntensity={PH_LAYER.intensity}
                        gradient={PH_LAYER.gradient}
                        {...CROP_PH_HEATMAP_SETTINGS}
                        showRover={false}
                        showFollowControl={false}
                      />
                    </div>
                    {showPhHeatmap && phHeatPoints.length > 0 && (
                      <div className="crop-ph-gradient-guide" aria-label="Soil pH heatmap color guide">
                        <div className="crop-ph-gradient-guide-title">Soil acidity / alkalinity (pH)</div>
                        <div className="crop-ph-gradient-bands">
                          {PH_LAYER.bands.map(band => (
                            <div className="crop-ph-gradient-band" key={band.label}>
                              <span className="crop-ph-gradient-swatch" style={{ backgroundColor: band.color }} />
                              <span>{band.label}</span>
                            </div>
                          ))}
                        </div>
                        <p>Estimated pH is shown only near samples or where nearby points support interpolation; colors do not indicate crop suitability.</p>
                      </div>
                    )}
                    <div className="crop-status-legend">
                      <span><i className="crop-dot match"/> All assessed preferences match</span>
                      <span><i className="crop-dot review"/> At least one condition needs review</span>
                      <span><i className="crop-dot insufficient"/> pH unavailable / invalid</span>
                    </div>
                    <div className="crop-sample-table-wrapper">
                      <table className="crop-sample-table">
                        <thead><tr><th>Point</th><th>pH</th><th>pH interpretation</th><th>Soil texture</th><th>Overall screening</th></tr></thead>
                        <tbody>
                          {analysis.evaluated.map(({ sample, criteria, status }, i) => (
                            <tr key={sample.id ?? `${i}-${sample.timestamp ?? ''}`}>
                              <td>{i + 1}</td>
                              <td>{criteria.ph.value == null ? '—' : criteria.ph.value.toFixed(2)}</td>
                              <td>{criteria.ph.status === 'match' ? 'Within preferred range'
                                : criteria.ph.status === 'below' ? `${criteria.ph.deviation} below preferred minimum`
                                : criteria.ph.status === 'above' ? `${criteria.ph.deviation} above preferred maximum`
                                : 'Not evaluated'}</td>
                              <td>{criteria.soilType.status === 'match' ? 'Preferred texture'
                                : criteria.soilType.status === 'review' ? 'Different from preferred textures'
                                : 'Not evaluated'}</td>
                              <td><span className={`crop-result ${status}`}>{status === 'matched' ? 'Preferences match' : status === 'review' ? 'Review conditions' : 'Insufficient data'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="crop-disclaimer">Screening does not consider climate, drainage, soil depth, salinity measured by standardized methods, or independently verified nutrients.</p>
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
          <div className="ui-dialog" style={{
            background: '#fff',
            borderRadius: '12px',
            padding: 'clamp(14px, 2vw, 24px)',
            width: 'min(620px, calc(100vw - 32px))',
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
                <option value="Tree Crop">Tree Crop</option>
                <option value="Legume">Legume</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Compatible soil types (optional; configure only from a verified crop reference)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
                {SOIL_TYPES.map(([value,label]) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem' }}>
                  <input type="checkbox" checked={(formData.compatibleSoilTypes || []).includes(value)}
                    onChange={e => setFormData(prev => ({ ...prev, compatibleSoilTypes: e.target.checked
                      ? [...(prev.compatibleSoilTypes || []), value]
                      : (prev.compatibleSoilTypes || []).filter(x => x !== value) }))} />
                  {label}
                </label>)}
              </div>
            </div>
            <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>Only pH and the preferred soil-type list affect compatibility. The other historical threshold fields are retained in the database but are not interpreted as validated crop nutrient requirements.</p>
            {/* Threshold Ranges */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {PARAMETERS.filter(p => p.key === 'ph').map((p) => (
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
