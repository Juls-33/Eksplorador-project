import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MapPin,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Package,
  HardDrive,
  Undo2,
  X
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import {
  fetchAllCoverage,
  estimateArea,
  startDownload,
  cancelDownload,
  dismissDownloadJob,
  TILE_SAFETY_CAP
} from '../services/tileStorage';
import useDownloadJob from '../hooks/useDownloadJob';

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
  const [removeMode, setRemoveMode] = useState(false); // when on, clicking a pin removes just that pin

  const [estimate, setEstimate] = useState(null);
  const [formError, setFormError] = useState(null);

  const [needsForceConfirm, setNeedsForceConfirm] = useState(false);
  const [forceConfirmed, setForceConfirmed] = useState(false);

  // The download itself lives in services/tileStorage.js, not in this view:
  // this view is unmounted whenever you switch tabs, but the job keeps
  // running and we simply re-attach to it when you come back.
  const job = useDownloadJob();
  const downloading = job.status === 'running';
  const prevJobStatusRef = useRef(job.status);

  const loadCoverage = async () => {
    setLoadingCoverage(true);
    const rows = await fetchAllCoverage();
    setCoverage(rows);
    setLoadingCoverage(false);
  };

  useEffect(() => {
    loadCoverage();
  }, []);

  useEffect(() => {
    if (prevJobStatusRef.current === 'running' && job.status !== 'running') {
      loadCoverage();
      if (job.status === 'done') {
        setForm(emptyForm);
        setDrawnPoints([]);
        setRemoveMode(false);
        setEstimate(null);
        setNeedsForceConfirm(false);
        setForceConfirmed(false);
      }
    }
    prevJobStatusRef.current = job.status;
  }, [job.status]);

  const previewBoundary = useMemo(() => rectangleBoundary(form), [form]);

  // The one place a new set of drawn points is applied. The form's bounding box
  // is always derived from whichever points remain, so adding, undoing and
  // removing a pin can never leave the coordinates out of step with the map.
  const applyPoints = (next) => {
    setDrawnPoints(next);
    if (next.length === 0) {
      setForm((prev) => ({ ...prev, south: '', west: '', north: '', east: '' }));
      setRemoveMode(false);
    } else {
      const lats = next.map((p) => p[0]);
      const lngs = next.map((p) => p[1]);
      setForm((prev) => ({
        ...prev,
        south: Math.min(...lats).toFixed(6),
        north: Math.max(...lats).toFixed(6),
        west: Math.min(...lngs).toFixed(6),
        east: Math.max(...lngs).toFixed(6)
      }));
    }
    setEstimate(null);
    setNeedsForceConfirm(false);
    setForceConfirmed(false);
  };

  const handleMapClick = (coords) => applyPoints([...drawnPoints, coords]);
  const handleUndoPin = () => applyPoints(drawnPoints.slice(0, -1));
  const handleRemovePin = (index) => applyPoints(drawnPoints.filter((_, i) => i !== index));
  const clearDrawing = () => applyPoints([]);

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
  };

  const handleDownload = () => {
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

    try {
      startDownload(area, { force: overCap });
      setFormError(null);
      setNeedsForceConfirm(false);
      setForceConfirmed(false);
    } catch (err) {
      setFormError(err.message || 'Could not start the download.');
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

      {job.status !== 'idle' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              {job.status === 'running' && 'Download in progress'}
              {job.status === 'done' && 'Download complete'}
              {job.status === 'cancelled' && 'Download cancelled'}
              {job.status === 'error' && 'Download failed'}
              {job.area ? ` · ${job.area.name}` : ''}
            </span>
          </div>
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
            {job.status === 'running' && job.progress && (
              <>
                <div style={{ height: '8px', borderRadius: '4px', background: '#e2e8f0', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (job.progress.done / Math.max(1, job.progress.total)) * 100)}%`,
                      background: 'var(--primary-green)',
                      transition: 'width 0.2s'
                    }}
                  />
                </div>
                <span style={{ color: 'var(--text-muted)' }}>
                  {job.progress.done.toLocaleString()} / {job.progress.total.toLocaleString()} (downloaded{' '}
                  {job.progress.downloaded.toLocaleString()}, skipped {job.progress.skipped.toLocaleString()}, failed{' '}
                  {job.progress.failed.toLocaleString()})
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  This keeps running if you switch to another tab — the Offline Maps item in the sidebar shows its
                  progress. Closing the app stops it, but tiles already saved are reused next time.
                </span>
                <button
                  className="badge"
                  onClick={cancelDownload}
                  disabled={job.cancelRequested}
                  style={{ cursor: job.cancelRequested ? 'default' : 'pointer', alignSelf: 'flex-start' }}
                >
                  <X size={13} /> {job.cancelRequested ? 'Cancelling…' : 'Cancel download'}
                </button>
              </>
            )}

            {job.status === 'done' && job.result && (
              <span style={{ color: 'var(--primary-green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} /> Downloaded {job.result.downloaded.toLocaleString()}, skipped{' '}
                {job.result.skipped.toLocaleString()} (already had them)
                {job.result.failures.length > 0 && `, ${job.result.failures.length} failed — try again later`}.
              </span>
            )}

            {job.status === 'cancelled' && job.result && (
              <span style={{ color: 'var(--text-muted)' }}>
                Stopped after saving {job.result.downloaded.toLocaleString()} new tiles. They're kept and will be
                reused if you download this area again, but the area isn't listed as covered until a download finishes.
              </span>
            )}

            {job.status === 'error' && (
              <span style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={14} /> {job.error}
              </span>
            )}

            {job.status !== 'running' && (
              <button className="badge" onClick={dismissDownloadJob} style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

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
              labeledPoints={removeMode ? [] : drawnPoints.map((p, i) => ({ lat: p[0], lng: p[1], label: i + 1 }))}
              waypoints={removeMode ? drawnPoints : []}
              waypointsDeletable={removeMode}
              onWaypointDelete={handleRemovePin}
              onMapClick={handleMapClick}
              interactionMode={removeMode ? 'NONE' : 'SET_WAYPOINTS'}
              showRover={false}
              showFollowControl={false}
            />
          </div>
          {drawnPoints.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <button className="badge" onClick={handleUndoPin} disabled={removeMode} style={{ cursor: 'pointer' }}>
                <Undo2 size={13} /> Undo last pin
              </button>
              <button
                className="badge"
                onClick={() => setRemoveMode((prev) => !prev)}
                title="Click any pin on the map to remove just that one"
                style={{
                  cursor: 'pointer',
                  background: removeMode ? '#dc2626' : undefined,
                  color: removeMode ? '#fff' : undefined,
                  borderColor: removeMode ? '#dc2626' : undefined
                }}
              >
                <Trash2 size={13} /> {removeMode ? 'Done removing' : 'Remove a pin'}
              </button>
              <button className="badge" onClick={clearDrawing} style={{ cursor: 'pointer' }}>
                Clear all
              </button>
              {removeMode && (
                <span style={{ fontSize: '0.75rem', color: '#991b1b' }}>
                  Click a red × on the map to remove that pin.
                </span>
              )}
            </div>
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
        </div>
      </div>
    </div>
  );
}