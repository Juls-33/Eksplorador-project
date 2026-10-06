import React, { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Package,
  HardDrive
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import { fetchAllCoverage, estimateArea, downloadArea, TILE_SAFETY_CAP } from '../services/tileStorage';

const emptyForm = {
  name: '',
  south: '',
  west: '',
  north: '',
  east: '',
  minZoom: 13,
  maxZoom: 18
};

function rectangleBoundary({ south, west, north, east }) {
  const vals = [south, west, north, east].map(Number);
  if (vals.some((v) => !Number.isFinite(v))) return [];
  const [s, w, n, e] = vals;
  return [[s, w], [s, e], [n, e], [n, w]];
}

export default function TileManagerView() {
  const [coverage, setCoverage] = useState([]);
  const [loadingCoverage, setLoadingCoverage] = useState(true);

  const [form, setForm] = useState(emptyForm);
  const [drawnPoints, setDrawnPoints] = useState([]); // raw clicks; their bounding envelope fills the form fields

  const [estimate, setEstimate] = useState(null);
  const [formError, setFormError] = useState(null);

  const [needsForceConfirm, setNeedsForceConfirm] = useState(false);
  const [forceConfirmed, setForceConfirmed] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [resultSummary, setResultSummary] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const loadCoverage = async () => {
    setLoadingCoverage(true);
    const rows = await fetchAllCoverage();
    setCoverage(rows);
    setLoadingCoverage(false);
  };

  useEffect(() => {
    loadCoverage();
  }, []);

  const previewBoundary = useMemo(() => rectangleBoundary(form), [form]);

  const handleMapClick = (coords) => {
    const next = [...drawnPoints, coords];
    setDrawnPoints(next);
    const lats = next.map((p) => p[0]);
    const lngs = next.map((p) => p[1]);
    setForm((prev) => ({
      ...prev,
      south: Math.min(...lats).toFixed(6),
      north: Math.max(...lats).toFixed(6),
      west: Math.min(...lngs).toFixed(6),
      east: Math.max(...lngs).toFixed(6)
    }));
    setEstimate(null);
    setNeedsForceConfirm(false);
    setForceConfirmed(false);
  };

  const clearDrawing = () => {
    setDrawnPoints([]);
    setForm((prev) => ({ ...prev, south: '', west: '', north: '', east: '' }));
    setEstimate(null);
  };

  const parsedArea = () => {
    const south = parseFloat(form.south);
    const west = parseFloat(form.west);
    const north = parseFloat(form.north);
    const east = parseFloat(form.east);
    const minZoom = parseInt(form.minZoom, 10);
    const maxZoom = parseInt(form.maxZoom, 10);

    if (!form.name.trim()) return { error: 'Give this area a name.' };
    if (![south, west, north, east].every(Number.isFinite)) return { error: 'Draw an area on the map, or fill in all four coordinates.' };
    if (south >= north) return { error: 'South must be less than North.' };
    if (west >= east) return { error: 'West must be less than East.' };
    if (!Number.isFinite(minZoom) || !Number.isFinite(maxZoom) || minZoom > maxZoom) return { error: 'Zoom range is invalid.' };

    return { area: { name: form.name.trim(), south, west, north, east, minZoom, maxZoom } };
  };

  const handleEstimate = () => {
    const { area, error } = parsedArea();
    if (error) {
      setFormError(error);
      setEstimate(null);
      return;
    }
    setFormError(null);
    setEstimate(estimateArea(area));
    setNeedsForceConfirm(false);
    setForceConfirmed(false);
    setResultSummary(null);
    setDownloadError(null);
  };

  const handleDownload = async () => {
    const { area, error } = parsedArea();
    if (error) {
      setFormError(error);
      return;
    }

    const plan = estimate || estimateArea(area);
    const overCap = plan.total > TILE_SAFETY_CAP;
    if (overCap && !forceConfirmed) {
      setNeedsForceConfirm(true);
      return;
    }

    setDownloading(true);
    setDownloadError(null);
    setResultSummary(null);
    setProgress({ done: 0, total: plan.total, downloaded: 0, skipped: 0, failed: 0 });

    try {
      const result = await downloadArea(area, { force: overCap, onProgress: setProgress });
      setResultSummary(result);
      setForm(emptyForm);
      setDrawnPoints([]);
      setEstimate(null);
      setNeedsForceConfirm(false);
      setForceConfirmed(false);
      await loadCoverage();
    } catch (err) {
      setDownloadError(err.message || 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="tile-manager-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Offline Map Coverage</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Tiles bundled with the app, plus anything you've downloaded on this device.
        </p>
      </div>

      {/* Coverage list */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Covered Areas</span>
        </div>
        <div style={{ padding: '12px' }}>
          {loadingCoverage ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
          ) : coverage.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No offline map tiles found yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {coverage.map((area, i) => (
                <div
                  key={`${area.name}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--card-border)',
                    fontSize: '0.82rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {area.source === 'bundled' ? (
                      <Package size={14} color="var(--primary-green)" />
                    ) : (
                      <HardDrive size={14} color="#D99A2B" />
                    )}
                    <strong>{area.name}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>
                      z{area.minZoom}–{area.maxZoom}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      background: area.source === 'bundled' ? 'rgba(31,81,50,0.1)' : 'rgba(217,154,43,0.15)',
                      color: area.source === 'bundled' ? 'var(--primary-green)' : '#8A5A35'
                    }}
                  >
                    {area.source === 'bundled' ? 'Shipped with app' : 'Downloaded here'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Download a new area */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Download a New Area</span>
        </div>
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Click on the map to mark corners of the area you need — the box around your clicks becomes the download
            area — or type coordinates directly below.
          </p>

          <div style={{ height: '320px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--card-border)' }}>
            <HeatmapMap
              boundary={previewBoundary}
              labeledPoints={drawnPoints.map((p, i) => ({ lat: p[0], lng: p[1], label: i + 1 }))}
              onMapClick={handleMapClick}
              interactionMode="SET_WAYPOINTS"
              showRover={false}
              showFollowControl={false}
            />
          </div>
          {drawnPoints.length > 0 && (
            <button className="badge" onClick={clearDrawing} style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
              <Trash2 size={13} /> Clear Drawing
            </button>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label style={{ fontSize: '0.78rem', gridColumn: '1 / -1' }}>
              Area name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. pampanga-site-1"
                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </label>
            {['south', 'west', 'north', 'east'].map((field) => (
              <label key={field} style={{ fontSize: '0.78rem', textTransform: 'capitalize' }}>
                {field}
                <input
                  type="number"
                  step="0.000001"
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
                />
              </label>
            ))}
            <label style={{ fontSize: '0.78rem' }}>
              Min zoom
              <input
                type="number"
                min="1"
                max="19"
                value={form.minZoom}
                onChange={(e) => setForm({ ...form, minZoom: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </label>
            <label style={{ fontSize: '0.78rem' }}>
              Max zoom
              <input
                type="number"
                min="1"
                max="19"
                value={form.maxZoom}
                onChange={(e) => setForm({ ...form, maxZoom: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' }}
              />
            </label>
          </div>

          {formError && (
            <p style={{ color: '#991b1b', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} /> {formError}
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleEstimate}
              disabled={downloading}
              style={{ padding: '7px 14px', borderRadius: '6px', border: '1px solid var(--card-border)', background: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Estimate
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading || !estimate}
              style={{
                padding: '7px 14px',
                borderRadius: '6px',
                border: 'none',
                background: downloading || !estimate ? '#94a3b8' : 'var(--primary-green)',
                color: '#fff',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: downloading || !estimate ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Download size={14} /> Download
            </button>
          </div>

          {estimate && (
            <div style={{ padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', fontSize: '0.8rem' }}>
              <strong>{estimate.total.toLocaleString()} tiles</strong> · ~{estimate.estimatedGB.toFixed(2)} GB · ~
              {estimate.estimatedMinutes.toFixed(1)} min
              {estimate.total > TILE_SAFETY_CAP && (
                <p style={{ margin: '6px 0 0', color: '#92400e' }}>
                  This is above the {TILE_SAFETY_CAP.toLocaleString()}-tile recommended limit. Consider a smaller area
                  or a lower max zoom.
                </p>
              )}
            </div>
          )}

          {needsForceConfirm && (
            <div style={{ padding: '10px', background: '#fef3c7', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span>
                <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                This will download {estimate.total.toLocaleString()} tiles. Continue anyway?
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="checkbox" checked={forceConfirmed} onChange={(e) => setForceConfirmed(e.target.checked)} />
                Yes, I understand and want to proceed
              </label>
              <button
                onClick={handleDownload}
                disabled={!forceConfirmed}
                style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: '6px', border: 'none', background: forceConfirmed ? '#b45309' : '#d1d5db', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: forceConfirmed ? 'pointer' : 'default' }}
              >
                Confirm Download
              </button>
            </div>
          )}

          {progress && downloading && (
            <div style={{ fontSize: '0.8rem' }}>
              <div style={{ height: '8px', borderRadius: '4px', background: '#e2e8f0', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%`,
                    background: 'var(--primary-green)',
                    transition: 'width 0.2s'
                  }}
                />
              </div>
              <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()} (downloaded {progress.downloaded.toLocaleString()}, skipped{' '}
                {progress.skipped.toLocaleString()}, failed {progress.failed.toLocaleString()})
              </p>
            </div>
          )}

          {resultSummary && (
            <p style={{ color: 'var(--primary-green)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={14} /> Downloaded {resultSummary.downloaded.toLocaleString()}, skipped{' '}
              {resultSummary.skipped.toLocaleString()} (already had them)
              {resultSummary.failures.length > 0 && `, ${resultSummary.failures.length} failed — try again later`}.
            </p>
          )}

          {downloadError && (
            <p style={{ color: '#991b1b', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} /> {downloadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}