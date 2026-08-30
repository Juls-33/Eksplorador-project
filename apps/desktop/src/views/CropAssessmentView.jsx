import React, { useState } from 'react';
import {
  Sprout,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MapPin,
  Sliders,
  Layers,
  ChevronRight,
  Filter,
  X,
  AlertCircle
} from 'lucide-react';

const initialCropProfiles = [
  {
    id: 'CRP-001',
    name: 'Rice (Oryza sativa)',
    category: 'Cereal / Grain',
    suitabilityScore: 94,
    status: 'Highly Suitable',
    statusColor: '#1F5132',
    suitablePlots: ['UST Field', 'North Plot A'],
    thresholds: {
      minPh: 5.5,
      maxPh: 7.0,
      minMoisture: 40,
      maxMoisture: 80,
      minEC: 0.5,
      maxEC: 2.0,
      optN: '20-40 mg/kg',
      optP: '30-50 mg/kg',
      optK: '40-70 mg/kg'
    },
    diagnostics: 'Soil pH (6.4 - 6.7) and high moisture retention are within ideal conditions for paddy development.'
  },
  {
    id: 'CRP-002',
    name: 'Sweet Corn (Zea mays)',
    category: 'Cereal / Grain',
    suitabilityScore: 88,
    status: 'Suitable',
    statusColor: '#1F5132',
    suitablePlots: ['North Plot A', 'UST Field'],
    thresholds: {
      minPh: 5.8,
      maxPh: 7.2,
      minMoisture: 30,
      maxMoisture: 60,
      minEC: 0.8,
      maxEC: 1.8,
      optN: '30-50 mg/kg',
      optP: '25-45 mg/kg',
      optK: '35-60 mg/kg'
    },
    diagnostics: 'Optimal drainage in North Plot A promotes deep root aeration. Nitrogen supplementation recommended for max yield.'
  },
  {
    id: 'CRP-003',
    name: 'Cassava / Tuber',
    category: 'Root Crop',
    suitabilityScore: 65,
    status: 'Moderate',
    statusColor: '#D99A2B',
    suitablePlots: ['South Plot B'],
    thresholds: {
      minPh: 5.0,
      maxPh: 6.5,
      minMoisture: 25,
      maxMoisture: 50,
      minEC: 0.4,
      maxEC: 1.2,
      optN: '15-30 mg/kg',
      optP: '20-35 mg/kg',
      optK: '40-60 mg/kg'
    },
    diagnostics: 'South Plot B sandy loam provides good tuber expansion, but potassium levels (33 mg/kg) are below optimal requirement.'
  },
  {
    id: 'CRP-004',
    name: 'Leafy Greens (Pechay / Brassica)',
    category: 'Vegetable',
    suitabilityScore: 42,
    status: 'Low Suitability',
    statusColor: '#8A5A35',
    suitablePlots: ['East Greenhouse'],
    thresholds: {
      minPh: 6.0,
      maxPh: 7.5,
      minMoisture: 50,
      maxMoisture: 75,
      minEC: 1.0,
      maxEC: 2.5,
      optN: '35-60 mg/kg',
      optP: '30-50 mg/kg',
      optK: '40-65 mg/kg'
    },
    diagnostics: 'Limiting Factor: Soil moisture in South Plot B is insufficient (37%). Requires dedicated drip irrigation and soil buffering.'
  }
];

export default function CropAssessmentView() {
  const [crops, setCrops] = useState(initialCropProfiles);
  const [selectedCropId, setSelectedCropId] = useState('CRP-001');
  const [filterCategory, setFilterCategory] = useState('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [modalError, setModalError] = useState(null);

  const [formData, setFormData] = useState({
    id: '',
    name: '',
    category: 'Cereal / Grain',
    minPh: 6.0,
    maxPh: 7.0,
    minMoisture: 35,
    maxMoisture: 65,
    minEC: 0.8,
    maxEC: 2.0,
    optN: '25-45 mg/kg',
    optP: '25-45 mg/kg',
    optK: '35-55 mg/kg',
    diagnostics: ''
  });

  const currentCrop = crops.find(c => c.id === selectedCropId) || crops[0];

  const filteredCrops = crops.filter(c => {
    return filterCategory === 'ALL' || c.category === filterCategory;
  });

  const handleOpenAddModal = () => {
    setFormData({
      id: `CRP-00${crops.length + 1}`,
      name: '',
      category: 'Cereal / Grain',
      minPh: 6.0,
      maxPh: 7.0,
      minMoisture: 35,
      maxMoisture: 65,
      minEC: 0.8,
      maxEC: 2.0,
      optN: '25-45 mg/kg',
      optP: '25-45 mg/kg',
      optK: '35-55 mg/kg',
      diagnostics: ''
    });
    setIsEditing(false);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (crop) => {
    setFormData({
      id: crop.id,
      name: crop.name,
      category: crop.category,
      minPh: crop.thresholds.minPh,
      maxPh: crop.thresholds.maxPh,
      minMoisture: crop.thresholds.minMoisture,
      maxMoisture: crop.thresholds.maxMoisture,
      minEC: crop.thresholds.minEC,
      maxEC: crop.thresholds.maxEC,
      optN: crop.thresholds.optN,
      optP: crop.thresholds.optP,
      optK: crop.thresholds.optK,
      diagnostics: crop.diagnostics
    });
    setIsEditing(true);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleDeleteCrop = (cropId) => {
    const updated = crops.filter(c => c.id !== cropId);
    setCrops(updated);
    if (selectedCropId === cropId) {
      setSelectedCropId(updated[0]?.id || '');
    }
  };

  const handleSaveCrop = () => {
    if (!formData.name.trim()) {
      setModalError('Crop name cannot be empty.');
      return;
    }
    if (parseFloat(formData.minPh) >= parseFloat(formData.maxPh)) {
      setModalError('Min pH must be lower than Max pH.');
      return;
    }

    if (isEditing) {
      setCrops(prev => prev.map(c => {
        if (c.id === formData.id) {
          return {
            ...c,
            name: formData.name,
            category: formData.category,
            diagnostics: formData.diagnostics || 'Custom crop threshold requirements applied.',
            thresholds: {
              minPh: parseFloat(formData.minPh),
              maxPh: parseFloat(formData.maxPh),
              minMoisture: parseFloat(formData.minMoisture),
              maxMoisture: parseFloat(formData.maxMoisture),
              minEC: parseFloat(formData.minEC),
              maxEC: parseFloat(formData.maxEC),
              optN: formData.optN,
              optP: formData.optP,
              optK: formData.optK
            }
          };
        }
        return c;
      }));
    } else {
      const newEntry = {
        id: formData.id,
        name: formData.name,
        category: formData.category,
        suitabilityScore: 82,
        status: 'Suitable',
        statusColor: 'var(--primary-green)',
        suitablePlots: ['North Plot A', 'UST Field'],
        thresholds: {
          minPh: parseFloat(formData.minPh),
          maxPh: parseFloat(formData.maxPh),
          minMoisture: parseFloat(formData.minMoisture),
          maxMoisture: parseFloat(formData.maxMoisture),
          minEC: parseFloat(formData.minEC),
          maxEC: parseFloat(formData.maxEC),
          optN: formData.optN,
          optP: formData.optP,
          optK: formData.optK
        },
        diagnostics: formData.diagnostics || 'Crop evaluation calculated based on user-defined threshold limits.'
      };
      setCrops(prev => [...prev, newEntry]);
      setSelectedCropId(newEntry.id);
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{crop.name}</strong>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: crop.suitabilityScore >= 80 ? '#dcfce7' : crop.suitabilityScore >= 60 ? '#fef3c7' : '#fee2e2',
                        color: crop.suitabilityScore >= 80 ? '#166534' : crop.suitabilityScore >= 60 ? '#92400e' : '#991b1b'
                      }}
                    >
                      {crop.suitabilityScore}% Match
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    <span>{crop.category}</span>
                    <span>{crop.suitablePlots.length} Suitable Plots</span>
                  </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      background: currentCrop.suitabilityScore >= 80 ? '#dcfce7' : currentCrop.suitabilityScore >= 60 ? '#fef3c7' : '#fee2e2',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>OVERALL VIABILITY</span>
                      <strong style={{ fontSize: '1.4rem', color: currentCrop.statusColor }}>{currentCrop.suitabilityScore}%</strong>
                    </div>

                    <div style={{ flex: 1, fontSize: '0.82rem' }}>
                      <div style={{ fontWeight: 700, color: currentCrop.statusColor, marginBottom: '2px' }}>
                        {currentCrop.status}
                      </div>
                      <p style={{ color: 'var(--text-muted)' }}>{currentCrop.diagnostics}</p>
                    </div>
                  </div>

                  {/* Compatible Plots Tags */}
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      ACCOMMODATING FIELD PLOTS:
                    </span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {currentCrop.suitablePlots.map(plot => (
                        <span
                          key={plot}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            background: 'var(--bg-main)',
                            border: '1px solid var(--card-border)',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}
                        >
                          <MapPin size={12} color="var(--primary-green)" />
                          {plot}
                        </span>
                      ))}
                    </div>
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
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--earth-dark)' }}>{currentCrop.thresholds.optN}</div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Opt. Phosphorus (P)</span>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--earth-dark)' }}>{currentCrop.thresholds.optP}</div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Opt. Potassium (K)</span>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--earth-dark)' }}>{currentCrop.thresholds.optK}</div>
                  </div>
                </div>
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
            width: '480px',
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
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Min / Max pH</label>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.minPh}
                    onChange={e => setFormData({ ...formData, minPh: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={formData.maxPh}
                    onChange={e => setFormData({ ...formData, maxPh: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Min / Max Moisture (%)</label>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <input
                    type="number"
                    value={formData.minMoisture}
                    onChange={e => setFormData({ ...formData, minMoisture: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                  />
                  <input
                    type="number"
                    value={formData.maxMoisture}
                    onChange={e => setFormData({ ...formData, maxMoisture: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                  />
                </div>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Limiting Factor / Notes</label>
              <textarea
                rows="2"
                placeholder="Optional diagnostic or soil amendment guidelines..."
                value={formData.diagnostics}
                onChange={e => setFormData({ ...formData, diagnostics: e.target.value })}
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