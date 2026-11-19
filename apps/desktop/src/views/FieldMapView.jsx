import { invoke } from '@tauri-apps/api/core';
import { appDate } from '../utils/time';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import HelpButton from '../components/ui/HelpButton';
import { listen } from '@tauri-apps/api/event';
import {
  Play,
  Pause,
  RotateCcw,
  MapPin,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  AlertCircle,
  Layers,
  Info,
  Undo2,
  FileText,
  CheckCircle2,
  Timer,
  Sprout,
  Images,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import SoilTypeGuide from '../components/SoilTypeGuide';
import OperatorNavGuide from '../components/OperatorNavGuide';
import PointToPointMissionDialog from '../components/PointToPointMissionDialog';
import { operatorMapStart, choosePlanningGps } from '../utils/pointToPointMission.js';
// EKSPLORADOR_GPS_MISSION_FIX_V1
import MissionDeploymentWizard from '../components/MissionDeploymentWizard';
import MissionStatusReport from '../components/MissionStatusReport';

import { missionExperiment } from '../hooks/useMissionExperiment';
import LoRaConnectionStatus from '../components/LoRaConnectionStatus';

import { useLoRaConnection } from '../hooks/useLoRaConnection';
import { isPointInPolygon, calculatePolygonArea } from '../utils/geo';
import { computeReachedPins, firstPendingPin, PIN_REACH_RADIUS_M } from '../utils/pinProgress';
import { resolveSoilSampleLocation, isInsideSamplingField, SOIL_LOCATION_SOURCE } from '../utils/manualSampleGeotag';
import { fieldLayerPresentation } from '../utils/fieldHeatmapLayers';
import {
  saveSoilSample,
  saveMissionSoilReading,
  updateFieldSoilType,
  fetchMissionSamples,
  fetchMissionRawReadings,
  fetchFields,
  createField,
  updateFieldBoundary,
  renameField,
  deleteField,
  fetchMissions,
  createMission,
  updateMissionStatus,
  fetchFieldSamples,
  fetchFieldAmendments,
  createFieldAmendment
} from '../services/db';
import { summarizeSamples, compareSamples } from '../utils/soilHistory';
import { estimatedTdsMgL, ecDsM, summarizeSoilSession, recordUniqueSoilReading, samplingPhase, formatTimeLeft, MIN_AVERAGE_READINGS } from '../utils/soilSampling';
import { hasBoundary } from '../utils/fieldGeo';
import './FieldMapView.css';

// --- Constants & Layer Configurations ---
const DEFAULT_CENTER = [14.6095, 120.9895];
const EMPTY = [];

const STATUS_LABELS = {
  planned: 'Planned',
  in_progress: 'Active',
  completed: 'Finished',
  cancelled: 'Cancelled'
};

// Local calendar date (toISOString would give the UTC date, which is "yesterday" early morning in the PH)
const todayLocal = () => appDate();
const blankMission = () => ({ name: '', fieldId: '', date: todayLocal(), pinsMode: 'new', pinSourceId: '' });

const fmt = (value, decimals = 1) => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : '--';
};

const validNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const TREND_STYLE = {
  up: { symbol: '▲', color: '#0369a1' },
  down: { symbol: '▼', color: '#c2410c' },
  stable: { symbol: '•', color: 'var(--text-muted)' },
  none: { symbol: '–', color: 'var(--text-muted)' }
};

export default function FieldMapView({ onHelp }) {
  const receiverStatus = useLoRaConnection();
  const [deploymentSequence, setDeploymentSequence] = useState(null);
  const deploymentOpening = useRef(false);
  const [pointToPointOpen, setPointToPointOpen] = useState(false);
  const [pointToPointPicking, setPointToPointPicking] = useState(false);
  const [pointToPointPinIndex, setPointToPointPinIndex] = useState(0);
  const [pointToPointManualStart, setPointToPointManualStart] = useState(null);
  const [pointToPointOriginPreference, setPointToPointOriginPreference] = useState(null);
  const [fields, setFields] = useState([]);
  const [missions, setMissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fieldFilter, setFieldFilter] = useState('ALL'); // 'ALL' or a field id (as string)
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const [selectedLayerKey, setSelectedLayerKey] = useState('ph');

  // Mission Logging Telemetry State Machine
  const [missionState, setMissionState] = useState('IDLE'); // IDLE, IN_PROGRESS, PAUSED, FINISHED
  const [liveSamples, setLiveSamples] = useState([]);
  const [baselineSamples, setBaselineSamples] = useState([]);
  const [showRawPackets, setShowRawPackets] = useState(false);
  const [rawPackets, setRawPackets] = useState([]);
  const [rawPacketsLoading, setRawPacketsLoading] = useState(false);
  const [compareToId, setCompareToId] = useState(null); // null = previous mission of the same field
  // Prevent continuous telemetry from saving the same probe insertion repeatedly.
  // A new sample becomes eligible only after the probe is lifted and inserted again.
  const sampleCapturedForInsertionRef = useRef(false);
  const sampleSaveInFlightRef = useRef(false);
  const probeInsertedRef = useRef(false);
  const insertionGenerationRef = useRef(0);
  const pendingNoGpsSampleRef = useRef(null);
  const soilSessionRef = useRef(null);
  const [soilSessionStatus, setSoilSessionStatus] = useState({ phase: 'idle', remainingMs: 0, rawCount: 0 });
  const [readySoilSample, setReadySoilSample] = useState(null); // Only after a verified average has been saved.
  // Soil sample location is separate from the A→B navigation estimate.
  // Only an explicit operator choice may serve as the manual sample geotag.
  const [manualSoilLocationEnabled, setManualSoilLocationEnabled] = useState(false);
  const [manualSoilLocationPicking, setManualSoilLocationPicking] = useState(false);
  const [manualSoilLocation, setManualSoilLocation] = useState(null);

  // Live Rover Telemetry
  const [roverPos, setRoverPos] = useState(null);
  const [roverHeading, setRoverHeading] = useState(null);
  // Field Map and Point A now consume the same satellite-confirmed DATA fix.
  // FUS remains preferred for navigation whenever it is fresh and valid.
  const [telemetryNavGps, setTelemetryNavGps] = useState(null);
  const planningGps = receiverStatus.connected && !receiverStatus.connectionError
    ? choosePlanningGps(receiverStatus.planning_gps?.current ?? null, telemetryNavGps)
    : null;
  const gpsExpiry = useRef(null);
  useEffect(() => {
    if (!receiverStatus.connected || receiverStatus.connectionError) {
      setRoverPos(null); setRoverHeading(null);
      setTelemetryNavGps(null);
      clearTimeout(gpsExpiry.current);
    }
  }, [receiverStatus.connected, receiverStatus.connectionError]);
  useEffect(() => () => clearTimeout(gpsExpiry.current), []);
  const [manualReached, setManualReached] = useState([]); // pin indexes the operator ticked off by hand
  const [showSamplePins, setShowSamplePins] = useState(false); // numbered pins for every recorded sample

  // Wizard: IDLE -> DRAWING_BOUNDARY -> (PLACING_PINS ->) launch.
  // intent 'FIELD' = adding/finishing a field (save, or save and start a mission).
  // intent 'MISSION' = a mission is being set up (boundary is only drawn if the field has none).
  const [wizardStep, setWizardStep] = useState('IDLE');
  const [wizard, setWizard] = useState({ intent: 'MISSION', fieldId: null, fieldName: '' });
  const [tempBoundary, setTempBoundary] = useState([]);
  const [tempWaypoints, setTempWaypoints] = useState([]);
  const [pinDeleteMode, setPinDeleteMode] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [notification, setNotification] = useState(null);

  // Modals
  const [isMissionModalOpen, setIsMissionModalOpen] = useState(false);
  const [newMission, setNewMission] = useState(blankMission());
  const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');

  // Field management (rename / delete) inside the mission modal
  const [isManagingFields, setIsManagingFields] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [editFieldInput, setEditFieldInput] = useState('');
  const [fieldError, setFieldError] = useState(null);

  // Merged Soil Records (soil profile averages + amendments) for the viewed field
  const [fieldSamples, setFieldSamples] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [isAddingAmendment, setIsAddingAmendment] = useState(false);
  const [showTreatmentHistory, setShowTreatmentHistory] = useState(false);
  const [soilTypeGuideOpen, setSoilTypeGuideOpen] = useState(false);
  const [soilTypeSaving, setSoilTypeSaving] = useState(false);
  const [newTreatment, setNewTreatment] = useState('');

  const [latestSensorData, setLatestSensorData] = useState({
    moisture: '--',
    ph: '--',
    ec: '--',
    nitrogen: '--',
    phosphorus: '--',
    potassium: '--',
    soilValid: 0,
    lat: null,
    lng: null
  });

  const activeConfig = useMemo(() => fieldLayerPresentation(selectedLayerKey, liveSamples), [selectedLayerKey, liveSamples]);

  // ---------- Derived data ----------
  const fieldsById = useMemo(() => Object.fromEntries(fields.map((f) => [f.id, f])), [fields]);

  const visibleMissions = useMemo(
    () => (fieldFilter === 'ALL' ? missions : missions.filter((m) => String(m.fieldId) === fieldFilter)),
    [missions, fieldFilter]
  );

  const currentSelected = missions.find((m) => m.id === selectedMissionId) || null;
  const viewField = currentSelected
    ? fieldsById[currentSelected.fieldId]
    : fieldFilter !== 'ALL'
    ? fieldsById[fieldFilter]
    : null;

  const activeBoundary = wizardStep !== 'IDLE' ? tempBoundary : (viewField?.boundary || EMPTY);
  const displayedWaypoints = wizardStep !== 'IDLE' ? tempWaypoints : (currentSelected?.waypoints || EMPTY);

  // Which pins count as reached. Derived from the mission's recorded samples —
  // any pin, in any order (see utils/pinProgress.js) — plus any the operator
  // ticked off by hand with "Reached". Reading the samples, instead of hooking
  // the sensor listener, keeps navigation progress completely separate from
  // recording: samples are saved wherever the rover is, near a pin or not.
  const missionSamples = useMemo(
    () => liveSamples.filter((s) => currentSelected && String(s.mission_id) === String(currentSelected.id)),
    [liveSamples, currentSelected?.id]
  );

  // Every recorded sample gets a number: its position in recording order
  // (1 = the first sample of the mission). The same number is shown on the map
  // pin and in the samples table, so a table row can be matched to its spot in
  // the field. The number never changes as newer samples arrive.
  const numberedSamples = useMemo(
    () => missionSamples.map((sample, index) => ({ sample, number: index + 1 })),
    [missionSamples]
  );

  // Kept as a stable array (EMPTY when hidden) so the map only rebuilds its
  // markers when the samples or the toggle actually change.
  const samplePins = useMemo(() => {
    if (!showSamplePins || wizardStep !== 'IDLE') return EMPTY;
    return numberedSamples
      .map(({ sample, number }) => {
        const lat = validNumber(sample.lat ?? sample.coords?.[0]);
        const lng = validNumber(sample.lng ?? sample.coords?.[1]);
        return lat === null || lng === null ? null : {
          lat, lng, label: number, locationSource: sample.location_source ?? null
        };
      })
      .filter(Boolean);
  }, [numberedSamples, showSamplePins, wizardStep]);
  const { reached: autoReached, last: lastAutoReached } = useMemo(
    () =>
      wizardStep === 'IDLE'
        ? computeReachedPins(missionSamples, displayedWaypoints)
        : { reached: new Set(), last: null }, // draft pins have no recorded samples
    [missionSamples, displayedWaypoints, wizardStep]
  );
  const reachedPinIdxs = useMemo(
    () => new Set([...autoReached, ...manualReached]),
    [autoReached, manualReached]
  );
  // The pin to head for: the first one not yet reached.
  const currentWaypointIdx = firstPendingPin(displayedWaypoints.length, reachedPinIdxs);

  // Hand-ticked pins are indexes into whichever pin list is on screen, so drop
  // them when switching between a mission's pins and the draft pins.
  useEffect(() => {
    setManualReached([]);
  }, [wizardStep]);

  // Frame the map on the field (or, for legacy fields with no boundary, on its samples).
  // Memoized so the map only re-fits when the selection changes, not on every render.
  const focusPoints = useMemo(() => {
    if (wizardStep === 'DRAWING_BOUNDARY') return EMPTY;
    if (activeBoundary.length > 0) return activeBoundary;
    const coords = liveSamples.map((s) => [s.lat, s.lng]).filter(([a, b]) => a != null && b != null);
    return coords.length > 0 ? coords : EMPTY;
  }, [wizardStep, activeBoundary, liveSamples]);

  const heatPointsForLayer = useMemo(
    () =>
      liveSamples
        .map((s) => {
          const lat = validNumber(s.lat ?? s.coords?.[0]);
          const lng = validNumber(s.lng ?? s.coords?.[1]);
          const value = activeConfig.extractValue(s);

          if (lat === null || lng === null || value === null) return null;
          return [lat, lng, value];
        })
        .filter(Boolean),
    [liveSamples, activeConfig]
  );

  const groupedMissions = useMemo(
    () =>
      visibleMissions.reduce((acc, msn) => {
        acc[msn.fieldName] = acc[msn.fieldName] || [];
        acc[msn.fieldName].push(msn);
        return acc;
      }, {}),
    [visibleMissions]
  );

  const overview = useMemo(() => summarizeSamples(liveSamples), [liveSamples]);
  // Field-wide averages across every mission's samples ("merged" soil records)
  const fieldOverview = useMemo(() => summarizeSamples(fieldSamples), [fieldSamples]);

  // Earlier missions of the same field, newest first: the candidates for comparison
  const earlierMissions = useMemo(() => {
    if (!currentSelected) return [];
    return missions
      .filter(
        (m) =>
          m.fieldId === currentSelected.fieldId &&
          m.id !== currentSelected.id &&
          (m.date < currentSelected.date || (m.date === currentSelected.date && m.id < currentSelected.id))
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }, [missions, currentSelected]);

  const baselineMission = earlierMissions.find((m) => m.id === compareToId) || earlierMissions[0] || null;

  const comparison = useMemo(
    () => (baselineMission ? compareSamples(liveSamples, baselineSamples) : null),
    [baselineMission, liveSamples, baselineSamples]
  );

  // Missions of a field that have pins we could reuse, newest first
  const pinSourcesFor = (fieldId) =>
    missions
      .filter((m) => String(m.fieldId) === String(fieldId) && m.waypoints.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const pinDefaultsFor = (fieldId) => {
    const sources = pinSourcesFor(fieldId);
    return {
      fieldId: String(fieldId),
      pinSourceId: sources[0] ? String(sources[0].id) : '',
      pinsMode: sources[0] ? 'reuse' : 'new'
    };
  };

  // ---------- Data loading ----------
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const [fieldRows, missionRows] = await Promise.all([fetchFields(), fetchMissions()]);
      if (cancelled) return;
      setFields(fieldRows);
      setMissions(missionRows);
      setSelectedMissionId(missionRows[0]?.id ?? null);
      setIsLoading(false);
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // Samples of the selected mission
  useEffect(() => {
    if (selectedMissionId === null) {
      setLiveSamples([]);
      return undefined;
    }
    let cancelled = false;
    fetchMissionSamples(String(selectedMissionId)).then((rows) => {
      if (!cancelled) setLiveSamples(rows);
    });
    return () => { cancelled = true; };
  }, [selectedMissionId]);

  // Samples of the mission we are comparing against
  useEffect(() => {
    if (!baselineMission) {
      setBaselineSamples([]);
      return undefined;
    }
    let cancelled = false;
    fetchMissionSamples(String(baselineMission.id)).then((rows) => {
      if (!cancelled) setBaselineSamples(rows);
    });
    return () => { cancelled = true; };
  }, [baselineMission?.id]);

  // Merged samples + amendment log for whichever field is currently in view
  useEffect(() => {
    if (!viewField) {
      setFieldSamples([]);
      setAmendments([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all([fetchFieldSamples(viewField.id), fetchFieldAmendments(viewField.id)]).then(([samples, log]) => {
      if (cancelled) return;
      setFieldSamples(samples);
      setAmendments(log);
    });
    return () => { cancelled = true; };
  }, [viewField?.id]);

  const handleAddAmendment = async () => {
    if (!viewField || !newTreatment.trim()) return;
    const updated = await createFieldAmendment({ fieldId: viewField.id, treatment: newTreatment.trim(), operator: 'Operator' });
    if (!updated) {
      setNotification({ type: 'error', message: 'The amendment could not be saved to the database.' });
      return;
    }
    setAmendments(updated);
    setNewTreatment('');
    setIsAddingAmendment(false);
  };

  const selectMission = (id) => {
    setPointToPointOpen(false);
    setPointToPointPicking(false);
    setPointToPointManualStart(null);
    setPointToPointOriginPreference(null);
    setManualSoilLocationEnabled(false);
    setManualSoilLocationPicking(false);
    setManualSoilLocation(null);
    pendingNoGpsSampleRef.current = null;
    soilSessionRef.current = null;
    setSoilSessionStatus({ phase: 'idle', remainingMs: 0, rawCount: 0 });
    setReadySoilSample(null);
    probeInsertedRef.current = false;
    insertionGenerationRef.current += 1;
    // A prior SQLite write may still be finishing; keep the in-flight guard.
    setSelectedMissionId(id);
    setRawPackets([]);
    setShowRawPackets(false);
    setCompareToId(null);
    setManualReached([]);
    sampleCapturedForInsertionRef.current = false;
    setMissionState('IDLE'); // never keep logging into a different mission by accident
    setWizardStep('IDLE');
  };

  // Keep the selection valid when the field filter changes
  useEffect(() => {
    if (isLoading) return;
    if (selectedMissionId !== null && visibleMissions.some((m) => m.id === selectedMissionId)) return;
    const next = visibleMissions[0]?.id ?? null;
    if (next !== selectedMissionId) selectMission(next);
  }, [visibleMissions, selectedMissionId, isLoading]);

  // Every qualifying packet is archived with a mission and insertion ID.
  // Only the representative 5-minute average goes into telemetry/heatmaps.
  const finalizeActiveInsertion = async (session) => {
    if (!session || session.completed || session.finalizing || soilSessionRef.current !== session) return;
    if (samplingPhase(session, Date.now()).phase !== 'finalize') return;
    const average = summarizeSoilSession(session.readings, session.startedAt);
    if (average.count < MIN_AVERAGE_READINGS) return;

    const location = resolveSoilSampleLocation({
      gpsCoords: session.lastGps && Date.now() - session.lastGpsSeenAt <= 15000 ? session.lastGps : null,
      manualEnabled: manualSoilLocationEnabled,
      manualSelection: manualSoilLocation,
      boundary: activeBoundary
    });
    if (location.outsideField) {
      setNotification({ type: 'error', message: 'Sample GPS position is outside this field. Raw readings were kept, but no mapped sample was created.' });
      return;
    }
    if (!location.coords && manualSoilLocationEnabled && !manualSoilLocation) {
      setSoilSessionStatus({ phase: 'location', remainingMs: 0, rawCount: session.readings.length });
      return;
    }
    session.finalizing = true;
    try {
      // Do not claim a completed sample if any original packet could not be persisted.
      const writes = await Promise.allSettled(session.rawWrites);
      if (writes.some(w => w.status === 'rejected')) throw new Error('Some raw packets could not be stored');
      if (soilSessionRef.current !== session) return;
      const coord = location.coords;
      const newSample = {
        mission_id: String(session.missionId),
        session_id: session.id,
        plot: session.fieldName,
        coords: coord ?? [null, null],
        lat: coord?.[0] ?? null,
        lng: coord?.[1] ?? null,
        location_source: location.source,
        moisture: average.moisture,
        ph: average.ph,
        ec: average.ec,
        n: average.nitrogen,
        p: average.phosphorus,
        k: average.potassium,
        // Retain the legacy display index for compatibility; do not interpret as fertility.
        overall: average.moisture != null && average.ph != null
          ? Math.round((average.moisture + average.ph * 10) / 2) : null,
        timestamp: new Date().toISOString()
      };
      
      const saved = await saveSoilSample(newSample);
      if (!saved) throw new Error('Could not persist the final sample');

      // The operator may have lifted the probe or changed missions
      // while the asynchronous database write was underway.
      if (soilSessionRef.current !== session) {
        // The record may already be committed. Do not update UI state
        // for a session that is no longer active.
        return;
      }

      session.completed = true;

      sampleCapturedForInsertionRef.current = true;
      setLiveSamples(prev => [...prev, newSample]);
      setFieldSamples(prev => [...prev, newSample]);
      setMissions(prev => prev.map(m => String(m.id) === String(session.missionId) ? { ...m, sampleCount: m.sampleCount + 1 } : m));
      setSoilSessionStatus({ phase: 'ready', remainingMs: 0, rawCount: session.readings.length });
      setReadySoilSample({
        missionName: currentSelected?.name || `Mission #${session.missionId}`,
        sampleCount: average.count,
        rawCount: session.readings.length,
        values: { moisture: average.moisture, ph: average.ph, ec: average.ec, n: average.nitrogen, p: average.phosphorus, k: average.potassium },
        locationSource: location.source,
        coords: location.coords ?? null
      });
      if (manualSoilLocation) setManualSoilLocation(null);
      setNotification({
        type: 'success',
        message: `Five-minute post-buffer observation saved (${average.count} readings averaged after the 5 s lead-in). Probe is ready to be lifted. ${location.source === SOIL_LOCATION_SOURCE.GPS ? '' : 'Coordinates are operator-estimated or unavailable.'}`
      });
    } catch (error) {
      setNotification({ type: 'error', message: `Soil sample incomplete: ${String(error)}. Raw packets retained where possible.` });
    } finally {
      session.finalizing = false;
    }
  };

  // Countdown updates independently of packet arrivals. A stale LoRa feed must
  // not falsely declare that five minutes of valid observation were completed.
  useEffect(() => {
    if (missionState !== 'IN_PROGRESS') {
      if (soilSessionRef.current && !soilSessionRef.current.completed) {
        setNotification({ type: 'info', message: 'Observation interrupted. Already received raw packets remain stored; no five-minute average was created.' });
      }
      soilSessionRef.current = null;
      setSoilSessionStatus({ phase: 'idle', remainingMs: 0, rawCount: 0 });
      return;
    }
    const tick = () => {
      const session = soilSessionRef.current;
      if (!session) return;
      const status = samplingPhase(session, Date.now());
      setSoilSessionStatus(prev =>
        prev.phase === 'location' && !manualSoilLocation && manualSoilLocationEnabled
          ? { phase: 'location', remainingMs: 0, rawCount: session.readings.length }
          : { ...status, rawCount: session.readings.length }
      );
      if (status.phase === 'finalize') void finalizeActiveInsertion(session);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [missionState, currentSelected?.id, manualSoilLocation, manualSoilLocationEnabled, activeBoundary]);

  // ---------- Tauri serial/sensor live data listener ----------
  useEffect(() => {
    const unlistenPromise = listen('sensor-data', (event) => {
      const data = event.payload;
      // Battery packets share this event channel; never interpret one as a lifted soil probe.
      if (!data || data.error || data.type === 'battery') return;
      setLatestSensorData(data);
      const lat = validNumber(data.lat);
      const lng = validNumber(data.lng);
      const heading = validNumber(data.heading ?? data.course ?? data.bearing ?? data.gpsHeading);
      if (heading !== null) setRoverHeading(((heading % 360) + 360) % 360);
      const hasValidGps =
        lat !== null &&
        lng !== null &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180 &&
        !(lat === 0 && lng === 0) &&
        data.satsLocked !== null &&
        data.satsLocked !== undefined &&
        Number.isInteger(Number(data.satsLocked)) &&
        Number(data.satsLocked) > 0;
      if (hasValidGps) {
        // DATA has an actual satellite lock and nonzero coordinates; never
        // manufacture a GPS fix from map pins or previous readings.
        setTelemetryNavGps({ source: 'telemetry', valid: true,
          position: [lat, lng], satsLocked: Number(data.satsLocked),
          receivedAt: Date.now(), ageAtReceiptMs: 0 });
        setRoverPos([lat, lng]);
        clearTimeout(gpsExpiry.current);
        gpsExpiry.current = setTimeout(() => { setRoverPos(null); setRoverHeading(null); }, 5000);
      } else {
        setTelemetryNavGps(null);
        clearTimeout(gpsExpiry.current);
        setRoverPos(null); setRoverHeading(null);
      }
      if (missionState !== 'IN_PROGRESS' || !currentSelected || currentSelected.status !== 'in_progress') return;
      const inserted = data.soilValid === 1;
      let session = soilSessionRef.current;
      if (!inserted) {
        if (session) {
          if (!session.completed) {
            setNotification({ type: 'info', message: `Probe lifted before five-minute sample completion (${session.readings.length} raw packets retained). Reinsert and complete a new observation.` });
          }
          soilSessionRef.current = null;
          setSoilSessionStatus({ phase: 'idle', remainingMs: 0, rawCount: 0 });
        }
        return;
      }
      const receivedAt = Date.now();
      if (!session) {
        setReadySoilSample(null); // A new insertion replaces the last success state.
        session = {
          id: globalThis.crypto.randomUUID(),
          startedAt: receivedAt,
          lastSeen: receivedAt,
          missionId: currentSelected.id,
          fieldName: currentSelected.fieldName,
          readings: [],
          rawWrites: [],
          lastGps: null,
          lastGpsSeenAt: 0,
          finalizing: false,
          completed: false
        };
        soilSessionRef.current = session;
        setSoilSessionStatus({ phase: 'lead-in', remainingMs: 5000, rawCount: 0 });
      }
      if (String(session.missionId) !== String(currentSelected.id)) return;
      // Only fresh measurements refresh the five-minute session freshness.
      if (hasValidGps) {
        session.lastGps = [lat, lng];
        session.lastGpsSeenAt = receivedAt;
      }
      const receivedIso = new Date(receivedAt).toISOString();
      const reading = { receivedAt, data };
      recordUniqueSoilReading(session, reading);
      // Persist *every* packet during this insertion, including the lead-in and
      // packets received after the final average, to permit full audit/replay.
      const pending = saveMissionSoilReading({
        sessionId: session.id, missionId: session.missionId, receivedAt: receivedIso,
        data, coords: hasValidGps ? [lat, lng] : null
      });
      session.rawWrites.push(pending);
      // Avoid unhandled rejections if storage fails while the user is still sampling.
      void pending.catch(() => {});
      if (samplingPhase(session, receivedAt).phase === 'finalize') void finalizeActiveInsertion(session);
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, [missionState, currentSelected, activeBoundary, manualSoilLocationEnabled, manualSoilLocation]);

  const toggleRawPackets = async () => {
    if (showRawPackets) { setShowRawPackets(false); return; }
    if (!currentSelected) return;
    setShowRawPackets(true);
    setRawPacketsLoading(true);
    try {
      setRawPackets(await fetchMissionRawReadings(currentSelected.id));
    } catch (error) {
      setNotification({ type: 'error', message: `Could not load mission raw packets: ${String(error)}` });
    } finally { setRawPacketsLoading(false); }
  };

  // ---------- Wizard helpers ----------
  const resetWizard = () => {
    setWizardStep('IDLE');
    setTempBoundary([]);
    setTempWaypoints([]);
  };

  const openMissionModal = (presetFieldId = null) => {
    const fieldId =
      presetFieldId ??
      currentSelected?.fieldId ??
      (fieldFilter !== 'ALL' ? Number(fieldFilter) : fields[0]?.id);

    setNewMission(fieldId != null ? { ...blankMission(), ...pinDefaultsFor(fieldId) } : blankMission());
    setIsManagingFields(false);
    setFieldError(null);
    setIsMissionModalOpen(true);
  };

  const openFieldModal = () => {
    setNewFieldName('');
    setFieldError(null);
    setIsFieldModalOpen(true);
  };

  const startBoundaryForField = (field) => {
    setWizard({ intent: 'FIELD', fieldId: field.id, fieldName: field.name });
    setTempBoundary([]);
    setTempWaypoints([]);
    setWizardStep('DRAWING_BOUNDARY');
    setNotification({ type: 'info', message: `Click around the perimeter of ${field.name} to draw its boundary.` });
  };

  const handleFieldModalNext = () => {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    if (fields.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setFieldError(`A field named "${trimmed}" already exists.`);
      return;
    }
    setIsFieldModalOpen(false);
    setWizard({ intent: 'FIELD', fieldId: null, fieldName: trimmed });
    setTempBoundary([]);
    setTempWaypoints([]);
    setWizardStep('DRAWING_BOUNDARY');
    setNotification({ type: 'info', message: `Click around the perimeter of ${trimmed} to draw its boundary.` });
  };

  const handleMapClick = (coords) => {
    if (manualSoilLocationPicking && wizardStep === 'IDLE' && missionState === 'IN_PROGRESS') {
      if (!isInsideSamplingField(coords, activeBoundary)) {
        setNotification({ type: 'error', message: 'Choose a location inside the saved field boundary.' });
        return;
      }
      setManualSoilLocation({ coords, source: SOIL_LOCATION_SOURCE.OPERATOR_MAP });
      setManualSoilLocationPicking(false);
      setNotification({ type: 'info', message: 'Manual sample location selected. This is an operator estimate, not a GPS measurement.' });
      return;
    }
    if (pointToPointPicking && wizardStep === 'IDLE') {
      const estimated = operatorMapStart(coords);
      if (!estimated) {
        setNotification({ type: 'error', message: 'Select a valid location on the map.' });
        return;
      }
      setPointToPointManualStart(estimated);
      setPointToPointOriginPreference('MANUAL');
      setPointToPointPicking(false);
      setPointToPointOpen(true);
      setNotification({ type: 'info', message: 'Point A marked as an operator-estimated position; confirm your alignment in the pop-up.' });
      return;
    }
    if (wizardStep === 'DRAWING_BOUNDARY') {
      setTempBoundary((prev) => [...prev, coords]);
    } else if (wizardStep === 'PLACING_PINS') {
      if (tempBoundary.length >= 3 && !isPointInPolygon(coords, tempBoundary)) {
        setNotification({ type: 'error', message: 'Waypoints must be placed inside the field boundary.' });
        return;
      }
      setTempWaypoints((prev) => [...prev, coords]);
    }
  };

  // Saves the drawn boundary: creates the field, or sets the boundary of an existing one.
  // The boundary is fixed from here on, so later missions reuse it.
  const persistBoundary = async () => {
    if (tempBoundary.length < 3) {
      setNotification({ type: 'error', message: 'Please click at least 3 points on the map to define a closed boundary.' });
      return null;
    }

    setIsBusy(true);
    try {
      let field = null;
      if (wizard.fieldId) {
        field = await updateFieldBoundary(wizard.fieldId, tempBoundary);
      } else {
        const result = await createField({ name: wizard.fieldName, boundary: tempBoundary });
        if (result.error) {
          setNotification({ type: 'error', message: result.error });
          return null;
        }
        field = result.field;
      }

      if (!field) {
        setNotification({ type: 'error', message: 'The boundary could not be saved to the database.' });
        return null;
      }

      setFields((prev) => {
        const exists = prev.some((f) => f.id === field.id);
        const next = exists ? prev.map((f) => (f.id === field.id ? field : f)) : [...prev, field];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      return field;
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveFieldOnly = async () => {
    const field = await persistBoundary();
    if (!field) return;
    resetWizard();
    setFieldFilter(String(field.id));
    setNotification({ type: 'success', message: `Field "${field.name}" saved. You can start a mission on it any time.` });
  };

  const handleSaveFieldAndStartMission = async () => {
    const field = await persistBoundary();
    if (!field) return;
    resetWizard();
    setFieldFilter(String(field.id));
    setNewMission({ ...blankMission(), ...pinDefaultsFor(field.id) });
    setIsManagingFields(false);
    setIsMissionModalOpen(true);
  };

  // Mission started on a field that had no boundary yet: save it, then go on to the pins
  const handleConfirmBoundaryForMission = async () => {
    const field = await persistBoundary();
    if (!field) return;
    setWizard((prev) => ({ ...prev, fieldId: field.id }));
    setTempWaypoints([]);
    setWizardStep('PLACING_PINS');
    setNotification({ type: 'info', message: 'Click inside the boundary to place rover waypoints.' });
  };

  const handleMissionModalNext = async () => {
    const field = fieldsById[newMission.fieldId];
    if (!newMission.name.trim() || !field) return;

    setIsMissionModalOpen(false);
    setWizard({ intent: 'MISSION', fieldId: field.id, fieldName: field.name });
    setTempWaypoints([]);

    // Field without a boundary yet: it has to be drawn first
    if (!hasBoundary(field)) {
      setTempBoundary([]);
      setWizardStep('DRAWING_BOUNDARY');
      setNotification({ type: 'info', message: `${field.name} has no saved boundary. Click around its perimeter to draw it.` });
      return;
    }

    const source = pinSourcesFor(field.id).find((m) => String(m.id) === newMission.pinSourceId);
    const sourcePins = source ? source.waypoints : [];

    // Same boundary, same pins: nothing left to draw
    if (newMission.pinsMode === 'reuse' && sourcePins.length > 0) {
      await launchMission(field, sourcePins);
      return;
    }

    setTempBoundary(field.boundary);
    setTempWaypoints(newMission.pinsMode === 'modify' ? sourcePins.map((p) => [...p]) : []);
    setWizardStep('PLACING_PINS');
    setNotification({
      type: 'info',
      message: newMission.pinsMode === 'modify'
        ? 'Previous pins loaded. Click to add pins, or use Undo / Clear to change them.'
        : 'Click inside the boundary to place rover waypoints.'
    });
  };

  const launchMission = async (field, pins) => {
    if (pins.length === 0) {
      setNotification({ type: 'error', message: 'Please add at least 1 traversal waypoint inside the boundary.' });
      return;
    }

    setIsBusy(true);
    const created = await createMission({ fieldId: field.id, name: newMission.name, date: newMission.date, pins });
    setIsBusy(false);

    if (!created) {
      setNotification({ type: 'error', message: 'The mission could not be saved to the database.' });
      return;
    }

    setMissions((prev) => [created, ...prev]);
    setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, missionCount: f.missionCount + 1 } : f)));
    if (fieldFilter !== 'ALL') setFieldFilter(String(field.id));

    setSelectedMissionId(created.id);
    setCompareToId(null);
    setLiveSamples([]);
    soilSessionRef.current = null;
    sampleCapturedForInsertionRef.current = false;
    setManualReached([]);
    resetWizard();
    setMissionState('IN_PROGRESS'); // Auto-start telemetry logging
    setNotification({ type: 'success', message: `Mission "${created.name}" launched!` });
  };

  const handleLaunchFromPins = () => launchMission(fieldsById[wizard.fieldId], tempWaypoints);

  // Delete-by-click only applies while actually placing pins; never leave it
  // silently on and blocking normal pin-adding in some other wizard step.
  useEffect(() => {
    if (wizardStep !== 'PLACING_PINS') setPinDeleteMode(false);
  }, [wizardStep]);

  const handleFinishMission = async (id) => {
    const ok = await updateMissionStatus(id, 'completed');
    if (!ok) {
      setNotification({ type: 'error', message: 'The mission status could not be updated.' });
      return;
    }
    setMissions((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'completed' } : m)));
    soilSessionRef.current = null;
    setSoilSessionStatus({ phase: 'idle', remainingMs: 0, rawCount: 0 });
    setMissionState('FINISHED');
    setManualSoilLocationEnabled(false);
    setManualSoilLocationPicking(false);
    setManualSoilLocation(null);
    setNotification({ type: 'success', message: 'Mission completed and findings logged.' });
  };

  // Re-opens a mission that was marked finished before every pin was
  // actually sampled, so the operator can pick up logging where they left off.
  const handleResumeMission = async (id) => {
    const ok = await updateMissionStatus(id, 'in_progress');
    if (!ok) {
      setNotification({ type: 'error', message: 'The mission could not be resumed.' });
      return;
    }
    setMissions((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'in_progress' } : m)));
    setSelectedMissionId(id);
    setWizardStep('IDLE');
    setMissionState('IN_PROGRESS');
    setNotification({ type: 'success', message: 'Mission resumed — logging will continue for the remaining pins.' });
  };

  const openPointToPoint = () => {
    if (wizardStep !== 'IDLE' || !displayedWaypoints.length) return;
    setManualSoilLocationPicking(false);
    setPointToPointPinIndex(currentWaypointIdx < displayedWaypoints.length ? currentWaypointIdx : 0);
    setPointToPointOriginPreference(null);
    setPointToPointPicking(false);
    setPointToPointOpen(true);
  };

  const handleAdvanceWaypoint = () => {
    // Marks the current target as reached by hand. This changes only the
    // navigation progress. Rover position must come from live GPS telemetry
    // and should never be faked by a waypoint click.
    if (currentWaypointIdx >= displayedWaypoints.length) return;
    setManualReached((prev) => (prev.includes(currentWaypointIdx) ? prev : [...prev, currentWaypointIdx]));
  };

  // ---------- Field management (rename / delete) ----------
  const handleSaveEditField = async (field) => {
    const trimmed = editFieldInput.trim();
    if (!trimmed) return;
    if (fields.some((f) => f.id !== field.id && f.name.toLowerCase() === trimmed.toLowerCase())) {
      setFieldError('A field with this name already exists.');
      return;
    }
    const ok = await renameField(field.id, trimmed);
    if (!ok) {
      setFieldError('The field could not be renamed.');
      return;
    }
    setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, name: trimmed } : f)));
    setMissions((prev) => prev.map((m) => (m.fieldId === field.id ? { ...m, fieldName: trimmed } : m)));
    setEditingFieldId(null);
    setEditFieldInput('');
    setFieldError(null);
  };

  const handleDeleteField = async (field) => {
    if (field.missionCount > 0) {
      setFieldError(`Cannot delete "${field.name}" because it has missions.`);
      return;
    }
    const ok = await deleteField(field.id);
    if (!ok) {
      setFieldError('The field could not be deleted.');
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== field.id));
    if (fieldFilter === String(field.id)) setFieldFilter('ALL');
    if (String(newMission.fieldId) === String(field.id)) setNewMission((prev) => ({ ...prev, fieldId: '' }));
    setFieldError(null);
  };
  // Both the dropdown and visual guide use the same persisted classification.
  // No new schema or crop-scoring rules are introduced by this UX feature.
  const saveOperatorSoilType = async (type) => {
    if (!viewField || soilTypeSaving) return false;
    setSoilTypeSaving(true);
    try {
      const ok = await updateFieldSoilType(viewField.id, type);
      if (!ok) {
        setNotification({ type: 'error', message: 'Could not save the field soil classification.' });
        return false;
      }
      setFields(prev => prev.map(f => f.id === viewField.id ? { ...f, soilType: type } : f));
      setNotification({ type: 'success', message: `Soil type saved for ${viewField.name}. Crop Assessment will use it when crop-specific compatible soils are configured.` });
      return true;
    } catch (error) {
      console.error('Soil classification save failed:', error);
      setNotification({ type: 'error', message: 'Could not save the field soil classification.' });
      return false;
    } finally {
      setSoilTypeSaving(false);
    }
  };

  // ---------- Render helpers ----------
  const primaryBtn = (enabled = true) => ({
    cursor: enabled ? 'pointer' : 'not-allowed',
    padding: '8px 16px',
    background: enabled ? 'var(--primary-green)' : '#ccc',
    color: '#fff'
  });

  const selectedModalField = fieldsById[newMission.fieldId] || null;
  const modalPinSources = selectedModalField ? pinSourcesFor(selectedModalField.id) : [];
  const modalSource = modalPinSources.find((m) => String(m.id) === newMission.pinSourceId) || modalPinSources[0];
  const canProceedMission = Boolean(newMission.name.trim() && selectedModalField) && !isBusy;
  const missionNextLabel = !selectedModalField
    ? 'Next'
    : !hasBoundary(selectedModalField)
    ? 'Next: Draw Field Boundary'
    : newMission.pinsMode === 'reuse' && modalPinSources.length > 0
    ? 'Launch Mission'
    : 'Next: Place Pins';

  const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--card-border)', marginTop: '4px' };
  const labelStyle = { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' };
  const pointCount = wizardStep === 'DRAWING_BOUNDARY' ? tempBoundary.length : tempWaypoints.length;

    const handleSendMission = async (plan) => {
      if (!plan?.sequence?.trim()) {
        throw new Error('No movement sequence generated.');
      }

      if (deploymentOpening.current || deploymentSequence !== null) return;
      deploymentOpening.current = true;
      try {
        const namedPlan={...plan,displayName:currentSelected?.name||'Draft waypoint mission',databaseMissionId:currentSelected?.id??null};
        // The legacy recorder compares N1 waypoint tracks. A bounded TF movement
        // has no coordinate legs; do not attach that recorder to the A→B upload.
        if (namedPlan.protocol === 'N1') await missionExperiment.start(namedPlan);
        setDeploymentSequence(namedPlan);
      } catch (error) { deploymentOpening.current = false; throw error; }
    };

  return (
    <div className="field-map-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {deploymentSequence !== null && (
        <MissionDeploymentWizard
          plan={deploymentSequence}
          onClose={() => { deploymentOpening.current = false; setDeploymentSequence(null); }}
        />
      )}

      <PointToPointMissionDialog
        open={pointToPointOpen}
        onClose={() => setPointToPointOpen(false)}
        onPickMap={() => { setPointToPointOpen(false); setPointToPointPicking(true); setPointToPointOriginPreference('MANUAL'); }}
        onSend={async (plan) => { await handleSendMission(plan); setPointToPointOpen(false); }}
        gps={planningGps}
        manualStart={pointToPointManualStart}
        initialOrigin={pointToPointOriginPreference}
        waypoints={displayedWaypoints}
        pinIndex={pointToPointPinIndex}
        onPinChange={setPointToPointPinIndex}
        sending={deploymentSequence !== null}
      />
      <SoilTypeGuide
        open={soilTypeGuideOpen && Boolean(viewField)}
        value={viewField?.soilType || ''}
        saving={soilTypeSaving}
        onClose={() => setSoilTypeGuideOpen(false)}
        onChoose={async type => {
          if (await saveOperatorSoilType(type)) setSoilTypeGuideOpen(false);
        }}
      />
      {readySoilSample && (
        <div className="soil-ready-modal__backdrop" role="presentation">
          <div className="soil-ready-modal" role="dialog" aria-modal="true" aria-labelledby="soil-ready-title">
            <div className="soil-ready-modal__icon"><CheckCircle2 size={28} aria-hidden="true" /></div>
            <h3 id="soil-ready-title">Sample saved — Ready to lift</h3>
            <p>The five-minute observation is complete. The averaged sample was saved to <strong>{readySoilSample.missionName}</strong>. You may now retract the probe.</p>
            <div className="soil-ready-modal__data">
              <div><span>Valid averaged readings</span><strong>{readySoilSample.sampleCount}</strong></div>
              <div><span>Raw packets preserved</span><strong>{readySoilSample.rawCount}</strong></div>
              <div><span>Sample moisture</span><strong>{fmt(readySoilSample.values.moisture, 1)}%</strong></div>
              <div><span>Sample pH</span><strong>{fmt(readySoilSample.values.ph, 2)}</strong></div>
              <div><span>Sample EC</span><strong>{fmt(readySoilSample.values.ec, 0)} µS/cm</strong></div>
              <div><span>Location</span><strong>{readySoilSample.locationSource === SOIL_LOCATION_SOURCE.GPS ? 'GPS geotag' : readySoilSample.locationSource === SOIL_LOCATION_SOURCE.MISSION_PIN ? 'Mission pin' : readySoilSample.locationSource === SOIL_LOCATION_SOURCE.OPERATOR_MAP ? 'Manual map' : 'Unlocated'}</strong></div>
            </div>
            <button type="button" className="soil-ready-modal__button" onClick={() => setReadySoilSample(null)}>Acknowledge and continue</button>
            <small>New sampling begins on the next valid probe insertion after lifting.</small>
          </div>
        </div>
      )}
      {pointToPointPicking && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 8, background: '#fef3c7', color: '#78350f' }}>
          <MapPin size={16} /> Click on the Field Map to set Point A (operator estimate, not GPS).
          <button type="button" className="badge" onClick={() => { setPointToPointPicking(false); setPointToPointOpen(true); }}>Cancel selection</button>
        </div>
      )}

      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', id: 'field-map-header' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Field Map & Heatmap Analysis</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Multi-variable GIS heatmap layers, bounded spatial interpolation, and real-time telemetry updates.
          </p>
        </div>
        {/* Top Action Header */}
        <div className="rx-board-control" style={{width:'auto',maxWidth:'100%',marginLeft:'auto',textAlign:'right'}}>
          <LoRaConnectionStatus connection={receiverStatus} compact/>

        </div>

        <div className="view-header-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <HelpButton viewId="Field Map" onOpen={onHelp} />
          {wizardStep === 'DRAWING_BOUNDARY' && (
            <>
              <button className="badge" disabled={tempBoundary.length === 0} onClick={() => setTempBoundary((prev) => prev.slice(0, -1))} style={{ cursor: 'pointer' }}>
                <Undo2 size={14} /> Undo Point
              </button>

              {wizard.intent === 'FIELD' ? (
                <>
                  <button className="badge" disabled={tempBoundary.length < 3 || isBusy} onClick={handleSaveFieldOnly} style={primaryBtn(tempBoundary.length >= 3 && !isBusy)}>
                    <Check size={16} /> Save Field ({pointCount} points)
                  </button>
                  <button className="badge" disabled={tempBoundary.length < 3 || isBusy} onClick={handleSaveFieldAndStartMission} style={primaryBtn(tempBoundary.length >= 3 && !isBusy)}>
                    <Play size={16} /> Save & Start Mission
                  </button>
                </>
              ) : (
                <button className="badge" disabled={tempBoundary.length < 3 || isBusy} onClick={handleConfirmBoundaryForMission} style={primaryBtn(tempBoundary.length >= 3 && !isBusy)}>
                  <Check size={16} /> Save Boundary & Place Pins ({pointCount} points)
                </button>
              )}

              <button className="badge" onClick={resetWizard} style={{ cursor: 'pointer' }}>Cancel</button>
            </>
          )}

          {wizardStep === 'PLACING_PINS' && (
            <>
              <button className="badge" disabled={tempWaypoints.length === 0} onClick={() => setTempWaypoints((prev) => prev.slice(0, -1))} style={{ cursor: 'pointer' }}>
                <Undo2 size={14} /> Undo Pin
              </button>
              <button
                className="badge"
                disabled={tempWaypoints.length === 0}
                onClick={() => setPinDeleteMode((prev) => !prev)}
                title="Click a pin on the map to remove just that one, in any order"
                style={{
                  cursor: 'pointer',
                  background: pinDeleteMode ? '#dc2626' : undefined,
                  color: pinDeleteMode ? '#fff' : undefined,
                  borderColor: pinDeleteMode ? '#dc2626' : undefined
                }}
              >
                <Trash2 size={14} /> {pinDeleteMode ? 'Done Removing' : 'Remove a Pin'}
              </button>
              <button className="badge" disabled={tempWaypoints.length === 0} onClick={() => setTempWaypoints([])} style={{ cursor: 'pointer' }}>
                <Trash2 size={14} /> Clear Pins
              </button>
              {wizard.intent === 'MISSION' && hasBoundary(fieldsById[wizard.fieldId]) && (
                <button
                  className="badge"
                  onClick={() => {
                    setTempBoundary([...fieldsById[wizard.fieldId].boundary]);
                    setWizardStep('DRAWING_BOUNDARY');
                    setNotification({ type: 'info', message: 'Editing the saved boundary. Click to extend it, then confirm — pins will be cleared since the shape is changing.' });
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  Edit Field Boundary
                </button>
              )}
              <button className="badge badge-connected" disabled={tempWaypoints.length === 0 || isBusy} onClick={handleLaunchFromPins} style={primaryBtn(tempWaypoints.length > 0 && !isBusy)}>
                <Play size={16} /> Launch Mission ({pointCount} Pins)
              </button>
              <button className="badge" onClick={resetWizard} style={{ cursor: 'pointer' }}>Cancel</button>
            </>
          )}

          {wizardStep === 'IDLE' && (
            <>
              <button className="badge ui-control" style={{ cursor: 'pointer', padding: '8px 16px', border: '1px solid var(--primary-green)', color: 'var(--primary-green)', background: '#fff' }} onClick={openFieldModal}>
                <MapPin size={16} /> Add Field
              </button>
              <button className="badge ui-control" style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', padding: '8px 16px' }} onClick={() => openMissionModal()}>
                <Plus size={16} /> Start New Mission
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notification Alert */}
      {notification && (
        <div className={notification.type === 'success' ? 'ui-notice' : undefined} style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: notification.type === 'success' ? '#dcfce7' : notification.type === 'error' ? '#fee2e2' : '#fef3c7',
          color: notification.type === 'success' ? '#166534' : notification.type === 'error' ? '#991b1b' : '#92400e',
          fontSize: '0.85rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{notification.message}</span>
          <X size={14} style={{ cursor: 'pointer' }} onClick={() => setNotification(null)} />
        </div>
      )}

      {/* Field without a saved boundary (e.g. imported from older records) */}
      {wizardStep === 'IDLE' && viewField && !hasBoundary(viewField) && (
        <div style={{ padding: '8px 14px', borderRadius: '8px', background: '#f1f5f9', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><strong>{viewField.name}</strong> has no saved boundary yet. Draw it once and every mission on this field will reuse it.</span>
          <button className="badge" onClick={() => startBoundaryForField(viewField)} style={{ cursor: 'pointer' }}>Draw Boundary</button>
        </div>
      )}

      {/* Main 3-Column Layout */}
      <div className="field-map-layout">
        {/* Left Column: Field filter + Mission Directory */}
        <div className="card" style={{ overflowY: 'auto' }}>
          <div className="card-header">
            <span className="card-title">Mission Directory</span>
          </div>
          <div style={{ padding: '12px' }}>
            <select
              aria-label="Filter missions by field"
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.8rem', fontWeight: 700, marginBottom: '14px', background: '#fff', color: 'var(--text-dark)' }}
            >
              <option value="ALL">All fields ({fields.length})</option>
              {fields.map((f) => (
                <option key={f.id} value={String(f.id)}>{f.name} ({f.missionCount})</option>
              ))}
            </select>

            {isLoading && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading fields and missions...</p>}

            {!isLoading && fields.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No fields yet. Use Add Field to draw your first one.
              </p>
            )}

            {!isLoading && fields.length > 0 && visibleMissions.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No missions on this field yet. Use Start New Mission to sample it.
              </p>
            )}

            {Object.entries(groupedMissions).map(([loc, list]) => (
              <div key={loc} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--earth-light)', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MapPin size={12} /> {loc}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {list.map((m) => (
                    <button
                      type="button"
                      className="ui-selectable-card"
                      aria-pressed={selectedMissionId === m.id}
                      key={m.id}
                      onClick={() => selectMission(m.id)}
                      style={{
                        padding: '10px',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: selectedMissionId === m.id ? 'var(--primary-green)' : 'var(--card-border)',
                        background: selectedMissionId === m.id ? 'rgba(31, 81, 50, 0.05)' : '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
                        <strong style={{ fontSize: '0.85rem' }}>{m.name}</strong>
                        <span style={{
                          fontSize: '0.68rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: m.status === 'in_progress' ? '#dcfce7' : '#f1f5f9',
                          color: m.status === 'in_progress' ? '#166534' : 'var(--text-muted)',
                          fontWeight: 700,
                          flexShrink: 0
                        }}>
                          {STATUS_LABELS[m.status] || m.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                        <span>{m.date}</span>
                        <span>•</span>
                        <span>{m.sampleCount} pts</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Center Column: Interactive Map & Control Toolbar */}
        <div className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">
              {wizardStep === 'DRAWING_BOUNDARY'
                ? `✏️ Drawing boundary: ${wizard.fieldName}`
                : wizardStep === 'PLACING_PINS'
                ? `📍 Placing waypoints: ${wizard.fieldName}`
                : `Heatmap: ${currentSelected?.name || viewField?.name || 'No mission selected'}`}
            </span>

            {/* Live Telemetry Logging Controls & Layer Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {wizardStep === 'IDLE' && currentSelected?.status === 'in_progress' && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', borderRight: '1px solid #e2e8f0', paddingRight: '10px' }}>
                  {(missionState === 'IDLE' || missionState === 'FINISHED') && (
                    <button
                      className="badge"
                      style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
                      onClick={() => setMissionState('IN_PROGRESS')}
                    >
                      <Play size={12} /> Start Logging
                    </button>
                  )}

                  {missionState === 'IN_PROGRESS' && (
                    <button
                      className="badge"
                      style={{ background: '#eab308', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={() => { setMissionState('PAUSED'); setManualSoilLocationPicking(false); setManualSoilLocation(null); }}
                    >
                      <span className="pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />
                      <Pause size={12} /> Pause Logging
                    </button>
                  )}

                  {missionState === 'PAUSED' && (
                    <button
                      className="badge"
                      style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
                      onClick={() => setMissionState('IN_PROGRESS')}
                    >
                      <RotateCcw size={12} /> Resume
                    </button>
                  )}
                </div>
              )}

              {/* Layer Selection Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Layers size={14} color="var(--primary-green)" />
                <select
                  value={selectedLayerKey}
                  onChange={(e) => setSelectedLayerKey(e.target.value)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--card-border)',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    outline: 'none',
                    background: '#fff',
                    color: 'var(--text-dark)'
                  }}
                >
                  <option value="ph">Soil pH — Acidity / Alkalinity</option>
                  <option value="moisture">Soil Moisture — Sampling Snapshot</option>
                  <option value="ec">Electrical Conductivity (EC)</option>
                  <option value="nitrogen">Nitrogen (N) — Sensor Estimate</option>
                  <option value="phosphorus">Phosphorus (P) — Sensor Estimate</option>
                  <option value="potassium">Potassium (K) — Sensor Estimate</option>
                </select>
              </div>
            </div>
          </div>

          {/* Keep manual geotagging *outside* Leaflet's map overlay. The map's
              offline-coverage selector is positioned top-right at z-index 1000;
              overlay controls here would compete with it and obscure clicks. */}
          {missionState === 'IN_PROGRESS' && wizardStep === 'IDLE' && (
            <div className="manual-sample-location-toolbar" role="region" aria-label="Soil sample location controls">
              <div className="manual-sample-location-toolbar__header">
                <div className="manual-sample-location-toolbar__label">
                  <MapPin size={16} aria-hidden="true" />
                  <div>
                    <strong>Soil sample location</strong>
                    <span>{roverPos ? 'GPS fix available · GPS will be used' : 'GPS unavailable · assign a location if needed'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="manual-sample-location-toolbar__toggle"
                  aria-pressed={manualSoilLocationEnabled}
                  aria-expanded={manualSoilLocationEnabled}
                  aria-controls="manual-soil-geotag-controls"
                  title="When GPS has no fix, select a map location or mission pin for the next soil sample"
                  onClick={() => {
                    setManualSoilLocationEnabled(previous => !previous);
                    setManualSoilLocationPicking(false);
                    setManualSoilLocation(null);
                  }}
                >
                  <MapPin size={13} /> Manual geotag: {manualSoilLocationEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              {manualSoilLocationEnabled && (
                <div id="manual-soil-geotag-controls" className="manual-sample-location-panel" role="group" aria-label="Manual soil geotag selectionDJASDHASJDHJASDHJASDAJHSDHAJSDJAHSDJHAHASDJ">
                {roverPos ? (
                  <p>GPS coordinates are available. Live GPS takes priority over any manual estimate.</p>
                ) : (
                  <p>No GPS position. Assign the <strong>next soil insertion</strong> a map coordinate or existing mission pin.</p>
                )}
                <div className="manual-sample-location-panel__actions">
                  <button type="button" className="badge" aria-pressed={manualSoilLocationPicking}
                    onClick={() => { setManualSoilLocationPicking(previous => !previous); setPointToPointPicking(false); }}>
                    <MapPin size={13} /> {manualSoilLocationPicking ? 'Cancel map pick' : 'Click on map'}
                  </button>
                  {displayedWaypoints.length > 0 && (
                    <select aria-label="Choose a mission pin as soil sample location" defaultValue=""
                      onChange={(event) => {
                        const index = Number(event.target.value);
                        if (!Number.isInteger(index) || !displayedWaypoints[index]) return;
                        const coords = displayedWaypoints[index];
                        if (!isInsideSamplingField(coords, activeBoundary)) {
                          setNotification({ type: 'error', message: 'That pin is outside the saved field boundary.' });
                          return;
                        }
                        setManualSoilLocation({ coords: [...coords], source: SOIL_LOCATION_SOURCE.MISSION_PIN, pinIndex: index });
                        setManualSoilLocationPicking(false);
                        event.target.value = '';
                      }}>
                      <option value="" disabled>Use an existing mission pin…</option>
                      {displayedWaypoints.map((_, index) => <option value={index} key={index}>Pin {index + 1}</option>)}
                    </select>
                  )}
                </div>
                {manualSoilLocationPicking && <div className="manual-sample-location-panel__pick">Click within the field boundary to place the sample marker.</div>}
                {manualSoilLocation ? (
                  <div className="manual-sample-location-panel__selected">
                    <strong>{manualSoilLocation.source === SOIL_LOCATION_SOURCE.MISSION_PIN ? `Pin ${manualSoilLocation.pinIndex + 1}` : 'Map estimate'} selected</strong>
                    <span>{manualSoilLocation.coords.map(n => Number(n).toFixed(6)).join(', ')}</span>
                    <button type="button" onClick={() => setManualSoilLocation(null)} aria-label="Clear manual soil sample location"><X size={14} /></button>
                  </div>
                ) : <p className="manual-sample-location-panel__waiting">{latestSensorData.soilValid === 1 && !roverPos ? 'Probe engaged: awaiting manual coordinate; do not lift until chosen.' : 'No manual sample location selected yet.'}</p>}
                <small>Operator-estimated coordinates are labeled separately in the database. GPS/RC navigation is not overridden.</small>
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1, position: 'relative', minHeight: '340px' }}>
            <HeatmapMap
              center={DEFAULT_CENTER}
              zoom={18}
              boundary={activeBoundary}
              waypoints={displayedWaypoints}
              heatPoints={heatPointsForLayer}
              valueToIntensity={activeConfig.valueToIntensity}
              maxInfluenceRadiusM={25}
              minInterpolationNeighbors={2}
              localCoverageRadiusM={5}
              labeledPoints={samplePins}
              focusPoints={focusPoints}
              roverPos={roverPos}
              planningStartPos={(pointToPointOpen || pointToPointPicking) && pointToPointOriginPreference === 'MANUAL' ? pointToPointManualStart?.coords ?? null : null}
              planningTargetPos={displayedWaypoints[pointToPointPinIndex] ?? null}
              manualSamplePos={missionState === 'IN_PROGRESS' && manualSoilLocationEnabled ? manualSoilLocation?.coords ?? null : null}
              onMapClick={handleMapClick}
              interactionMode={
                manualSoilLocationPicking && missionState === 'IN_PROGRESS' && wizardStep === 'IDLE' ? 'SELECT_SAMPLE_LOCATION' :
                pointToPointPicking && wizardStep === 'IDLE' ? 'SELECT_ROVER_START' :
                wizardStep === 'DRAWING_BOUNDARY'
                  ? 'DRAW_BOUNDARY'
                  : wizardStep === 'PLACING_PINS' && !pinDeleteMode
                  ? 'SET_WAYPOINTS'
                  : 'NONE'
              }
              waypointsDeletable={wizardStep === 'PLACING_PINS' && pinDeleteMode}
              onWaypointDelete={(index) => setTempWaypoints((prev) => prev.filter((_, i) => i !== index))}
              gradient={activeConfig.gradient}
            />
            {/* Map-centered sampling chip: shown during active mission logging, not in the sidebar. */}
            {missionState === 'IN_PROGRESS' && wizardStep === 'IDLE' && currentSelected && (
              <div className={`soil-map-timer-chip soil-map-timer-chip--${soilSessionStatus.phase}`} role="status" aria-live="polite">
                <span className="soil-map-timer-chip__icon"><Timer size={18} aria-hidden="true" /></span>
                <span className="soil-map-timer-chip__content">
                  <strong>{soilSessionStatus.phase === 'idle' ? 'Awaiting probe insertion' :
                    soilSessionStatus.phase === 'lead-in' ? 'LoRa lead-in buffer' :
                    soilSessionStatus.phase === 'observing' ? 'Soil sample in progress' :
                    soilSessionStatus.phase === 'stale' ? 'Telemetry delayed' :
                    soilSessionStatus.phase === 'insufficient' ? 'Need more sensor packets' :
                    soilSessionStatus.phase === 'location' ? 'Choose a sample geotag' :
                    soilSessionStatus.phase === 'ready' ? 'Sample saved — Ready to lift' : 'Saving sample…'}</strong>
                  <small>{soilSessionStatus.phase === 'idle' ? 'Insert probe to start 5:05 timer' :
                    soilSessionStatus.phase === 'lead-in' ? `${formatTimeLeft(soilSessionStatus.remainingMs)} until averaging begins` :
                    soilSessionStatus.phase === 'observing' ? `${formatTimeLeft(soilSessionStatus.remainingMs)} remaining · ${soilSessionStatus.rawCount} raw packets` :
                    soilSessionStatus.phase === 'stale' ? 'Do not lift; waiting for a fresh packet' :
                    soilSessionStatus.phase === 'insufficient' ? 'Keep inserted until more data arrive' :
                    soilSessionStatus.phase === 'location' ? 'Select map point or mission pin' :
                    soilSessionStatus.phase === 'ready' ? `${soilSessionStatus.rawCount} packets retained` : 'Do not lift yet'}</small>
                </span>
                {soilSessionStatus.phase === 'observing' && <span className="soil-map-timer-chip__clock">{formatTimeLeft(soilSessionStatus.remainingMs)}</span>}
                {(soilSessionStatus.phase === 'lead-in' || soilSessionStatus.phase === 'observing') && (
                  <span className="soil-map-timer-chip__track" aria-hidden="true">
                    <span style={{ width: `${Math.min(100,Math.max(0,(soilSessionStatus.phase === 'lead-in' ? 5000-soilSessionStatus.remainingMs : 5000+300000-soilSessionStatus.remainingMs)/305000*100))}%` }} />
                  </span>
                )}
              </div>
            )}
            {/* Paused-logging overlay: a translucent yellow wash so it's unmistakable at a glance */}
            {missionState === 'PAUSED' && wizardStep === 'IDLE' && (
              <div style={{
                position: 'absolute',
                inset: 0,
                zIndex: 900,
                background: 'rgba(234, 179, 8, 0.16)',
                border: '3px solid rgba(234, 179, 8, 0.6)',
                pointerEvents: 'none',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start'
              }}>
                <div style={{
                  marginTop: '14px',
                  background: '#eab308',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.25)'
                }}>
                  <Pause size={13} /> Logging Paused
                </div>
              </div>
            )}
            {/* Floating Color Legend Guide */}
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              zIndex: 1000,
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(4px)',
              border: '1px solid var(--card-border)',
              borderRadius: '8px',
              padding: '10px 12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              fontSize: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxWidth: '220px'
            }}>
              <div style={{ fontWeight: 800, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Info size={13} color="var(--primary-green)" />
                <span>{activeConfig.label} ({activeConfig.unit})</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {activeConfig.ranges.map((range, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: range.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, minWidth: '60px' }}>{range.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{range.desc}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.35, borderTop: '1px solid var(--card-border)', paddingTop: '6px' }}>
                Assumed coverage within 5 m of samples · IDW estimates with ≥2 sites within 25 m. Blank areas lack supported coverage.
                <details style={{ marginTop: '5px' }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--primary-green)', fontWeight: 700 }}>Interpretation & limitations</summary>
                  <p style={{ margin: '6px 0 0' }}>{activeConfig.note} Raw values are interpolated before applying colors. No fertilizer requirements are inferred.</p>
                </details>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Overview, Telemetry, Traversal, History */}
        <div className="field-map-layout__details">
          <div className="card" style={{ flexShrink: 0 }}>
            <div className="card-header">
              <span className="card-title">Mission Overview{currentSelected ? `: #${currentSelected.id}` : ''}</span>
              {currentSelected?.status === 'in_progress' && (
                <button
                  onClick={() => handleFinishMission(currentSelected.id)}
                  style={{ background: 'var(--accent-gold)', border: 'none', padding: '4px 8px', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Mark Finished
                </button>
              )}
              {currentSelected?.status === 'completed' && (
                <button
                  onClick={() => handleResumeMission(currentSelected.id)}
                  title={currentSelected.sampleCount < (currentSelected.waypoints?.length || 0) ? 'Not every pin was sampled — pick up where you left off' : 'Reopen this mission for more logging'}
                  style={{ background: 'var(--primary-green)', border: 'none', padding: '4px 8px', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <RotateCcw size={12} /> Resume Mission
                </button>
              )}
            </div>
            <div style={{ padding: '10px 12px', fontSize: '0.82rem' }}>
              {currentSelected ? (
                <>
                  <p style={{ color: 'var(--text-dark)', marginBottom: '8px' }}>
                    <strong>{currentSelected.name}</strong> on {currentSelected.fieldName} · {STATUS_LABELS[currentSelected.status]} · {currentSelected.date}
                    {hasBoundary(viewField) && <> · {calculatePolygonArea(viewField.boundary)} m²</>}
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg. Moisture</div>
                      <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--primary-green)' }}>
                        {fmt(overview.avg.moisture, 1)}{overview.avg.moisture !== null ? '%' : ''}
                      </div>
                    </div>
                    <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg. pH Level</div>
                      <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--earth-light)' }}>{fmt(overview.avg.ph, 2)}</div>
                    </div>
                    <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg. Conductivity</div>
                      <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{fmt(ecDsM(overview.avg.ec), 3)}{overview.avg.ec !== null ? ' dS/m' : ''}</div>
                    </div>
                    <div style={{ padding: '6px 8px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Samples Recorded</div>
                      <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{liveSamples.length} pts</div>
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>
                  {viewField
                    ? `${viewField.name} has no missions yet. Start one to begin collecting readings.`
                    : 'Select a mission, or add a field and start one.'}
                </p>
              )}
            </div>
          </div>

          {/* Live Sensor Telemetry Monitor Card */}
          <div className="card" style={{ flexShrink: 0 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Live Rover Telemetry</span>
              <span style={{
                fontSize: '0.68rem',
                padding: '2px 8px',
                borderRadius: '12px',
                fontWeight: 700,
                background: latestSensorData.soilValid === 1 ? '#dcfce7' : '#fee2e2',
                color: latestSensorData.soilValid === 1 ? '#166534' : '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: latestSensorData.soilValid === 1 ? '#22c55e' : '#ef4444'
                }} />
                {latestSensorData.soilValid === 1 ? 'Probe Engaged' : 'Probe Lifted'}
              </span>
            </div>

            <div style={{ padding: '10px 12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Moisture</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary-green)' }}>
                    {latestSensorData.moisture}{typeof latestSensorData.moisture === 'number' ? '%' : ''}
                  </div>
                </div>

                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>pH Level</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--earth-light)' }}>
                    {latestSensorData.ph}
                  </div>
                </div>

                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>EC (µS/cm)</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                    {latestSensorData.ec}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Estimated TDS: {fmt(estimatedTdsMgL(latestSensorData.ec), 1)} mg/L (0.60 × EC; not independently measured)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '6px' }}>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Nitrogen (N)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{latestSensorData.nitrogen}</div>
                </div>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Phosphorus (P)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{latestSensorData.phosphorus}</div>
                </div>
                <div style={{ padding: '6px', background: 'var(--bg-main)', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Potassium (K)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{latestSensorData.potassium}</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ flexShrink: 0 }}>
            <MissionStatusReport deployment={receiverStatus.deployment} connected={receiverStatus.connected}/>
            <OperatorNavGuide
              waypoints={displayedWaypoints}
              disabled={wizardStep !== 'IDLE' || deploymentSequence !== null || pointToPointPicking}
              onPlanMission={openPointToPoint}
            />
          </div>

          {/* Historical comparison against an earlier mission on the same field */}
          {currentSelected && wizardStep === 'IDLE' && (
            <div className="card" style={{ flexShrink: 0 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span className="card-title">Change Since Earlier Mission</span>
                {earlierMissions.length > 1 && (
                  <select
                    aria-label="Compare with"
                    value={baselineMission?.id ?? ''}
                    onChange={(e) => setCompareToId(Number(e.target.value))}
                    style={{ padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.72rem', maxWidth: '170px' }}
                  >
                    {earlierMissions.map((m) => (
                      <option key={m.id} value={m.id}>{m.date} · {m.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ padding: '10px 12px', fontSize: '0.82rem' }}>
                {!baselineMission ? (
                  <p style={{ color: 'var(--text-muted)' }}>
                    This is the first mission on {currentSelected.fieldName}. Run another mission on this field to see how its soil changes over time.
                  </p>
                ) : liveSamples.length === 0 || baselineSamples.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>
                    Not enough readings to compare yet. Both missions need recorded samples.
                  </p>
                ) : (
                  <>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Compared with <strong>{baselineMission.name}</strong> ({baselineMission.date})
                    </p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '4px 0', fontWeight: 600 }}>Parameter</th>
                          <th style={{ padding: '4px 0', fontWeight: 600 }}>Before</th>
                          <th style={{ padding: '4px 0', fontWeight: 600 }}>Now</th>
                          <th style={{ padding: '4px 0', fontWeight: 600 }}>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.rows.map((row) => {
                          const trend = TREND_STYLE[row.trend];
                          return (
                            <tr key={row.key} style={{ borderTop: '1px solid var(--card-border)' }}>
                              <td style={{ padding: '5px 0' }}>
                                {row.label}
                                {row.unit && <span style={{ color: 'var(--text-muted)' }}> ({row.unit})</span>}
                              </td>
                              <td style={{ padding: '5px 0' }}>{fmt(row.baseline, row.decimals)}</td>
                              <td style={{ padding: '5px 0' }}>{fmt(row.current, row.decimals)}</td>
                              <td style={{ padding: '5px 0', color: trend.color, fontWeight: 700 }}>
                                {trend.symbol} {row.delta === null ? '' : `${row.delta > 0 ? '+' : ''}${fmt(row.delta, row.decimals)}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '8px' }}>
                      {comparison.basis === 'matched'
                        ? `Basis: ${comparison.matchedCount} pins matched within ${comparison.radiusM} m of the earlier mission's pins. A change under the noise threshold shows as •.`
                        : `Basis: whole-mission averages (fewer than 3 pins matched within ${comparison.radiusM} m). A change under the noise threshold shows as •.`}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Soil Records: merged field profile (real sensor averages) + amendment log */}
          {viewField && wizardStep === 'IDLE' && (
            <div className="card" style={{ flexShrink: 0 }}>
              <div className="card-header">
                <span className="card-title">Soil Profile: {viewField.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fieldOverview.count} samples, all missions</span>
              </div>

              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {fieldOverview.count === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No samples recorded on this field yet.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '0.78rem' }}>
                    {[
                      { key: 'ph', label: 'Avg. pH', decimals: 2 },
                      { key: 'moisture', label: 'Avg. Moisture', decimals: 1, unit: '%' },
                      { key: 'ec', label: 'Avg. EC', decimals: 0, unit: ' µS/cm' },
                      { key: 'n', label: 'Avg. Nitrogen', decimals: 1, unit: ' mg/kg' },
                      { key: 'p', label: 'Avg. Phosphorus', decimals: 1, unit: ' mg/kg' },
                      { key: 'k', label: 'Avg. Potassium', decimals: 1, unit: ' mg/kg' }
                    ].map((s) => (
                      <div key={s.key} style={{ padding: '8px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{s.label}</div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                          {fmt(fieldOverview.avg[s.key], s.decimals)}{fieldOverview.avg[s.key] !== null ? (s.unit || '') : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="field-soil-type-panel">
                  <div className="field-soil-type-panel__heading"><Sprout size={17} aria-hidden="true" /><strong>Operator-tagged soil type</strong></div>
                  <p>Enter the field's observed soil classification. This is manual information used as context in Crop Assessment, not measured by the rover.</p>
                  <select aria-label="Operator-entered soil type" value={viewField?.soilType || ''} disabled={soilTypeSaving}
                    onChange={e => { void saveOperatorSoilType(e.target.value); }}>
                    <option value="">Select soil type (not classified)</option>
                    <option value="sandy">Sandy</option>
                    <option value="sandy-loam">Sandy loam</option>
                    <option value="loam">Loam</option>
                    <option value="clay-loam">Clay loam</option>
                    <option value="clay">Clay</option>
                    <option value="silt-loam">Silt loam</option>
                  </select>
                  <button type="button" className="field-soil-type-panel__guide-button" onClick={() => setSoilTypeGuideOpen(true)}>
                    <Images size={16} aria-hidden="true" /> View soil type pictures &amp; identification tips
                  </button>
                  <small>{viewField?.soilType ? 'Saved for this field. Crop matching is applied only for crops with configured, verified compatible soil types.' : 'Soil type has not yet been tagged for this field.'}</small>
                </div>
                <div className="field-treatment-history">
                  <button type="button" className="field-treatment-history__toggle" aria-expanded={showTreatmentHistory} onClick={() => setShowTreatmentHistory(v => !v)}>
                    <FileText size={15} aria-hidden="true" />
                    <span>Amendments &amp; Treatments <small>(optional history · {amendments.length} records)</small></span>
                    {showTreatmentHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {showTreatmentHistory && (
                    <div className="field-treatment-history__content">
                      <div className="field-treatment-history__actions">
                        <span>Prior compost, lime, fertilizer and other treatments</span>
                        <button className="badge" type="button" onClick={() => setIsAddingAmendment(!isAddingAmendment)}><Plus size={13} /> Add Record</button>
                      </div>
                  {isAddingAmendment && (
                    <div style={{ display: 'flex', gap: '8px', padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--card-border)', marginBottom: '8px' }}>
                      <input
                        type="text"
                        placeholder="e.g. Organic compost 150kg, Dolomite lime applied..."
                        value={newTreatment}
                        onChange={(e) => setNewTreatment(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddAmendment(); }}
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

                  {amendments.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No amendments logged for this field yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                      {amendments.map((item) => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '6px', border: '1px solid #f1f5f9', fontSize: '0.8rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle2 size={15} color="var(--primary-green)" />
                            <strong style={{ color: 'var(--text-dark)' }}>{item.treatment}</strong>
                          </div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{item.date} • Logged by {item.operator}</span>
                        </div>
                      ))}
                    </div>
                  )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Raw samples of the selected mission */}
          {currentSelected && wizardStep === 'IDLE' && (
            <div className="card" style={{ flexShrink: 0 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span className="card-title">Mission Samples</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{numberedSamples.length} samples</span>
                  <button type="button" className="badge" onClick={toggleRawPackets}
                    aria-pressed={showRawPackets} title="Inspect mission-linked raw sensor packets">
                    {showRawPackets ? 'Hide raw packets' : 'View raw packets'}
                  </button>
                  <button
                    type="button"
                    className="badge"
                    onClick={() => setShowSamplePins((prev) => !prev)}
                    disabled={numberedSamples.length === 0}
                    aria-pressed={showSamplePins}
                    title="Show every recorded sample on the map as a numbered pin"
                    style={{
                      cursor: numberedSamples.length === 0 ? 'default' : 'pointer',
                      background: showSamplePins ? 'var(--primary-green)' : undefined,
                      color: showSamplePins ? '#fff' : undefined
                    }}
                  >
                    <MapPin size={13} /> {showSamplePins ? 'Hide pins' : 'Show pins'}
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '240px', overflow: 'auto', padding: '0 12px 10px' }}>
                {numberedSamples.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '10px' }}>No samples recorded for this mission yet.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)', position: 'sticky', top: 0, background: '#fff' }}>
                        {['#', 'Time', 'Location', 'Moist', 'pH', 'EC', 'N', 'P', 'K'].map((h) => (
                          <th key={h} style={{ padding: '6px 6px 6px 0', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...numberedSamples].reverse().slice(0, 100).map(({ sample: s, number }) => (
                        <tr key={s.id ?? number} style={{ borderTop: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '4px 6px 4px 0' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                minWidth: '20px',
                                height: '20px',
                                padding: '0 5px',
                                borderRadius: '999px',
                                background: '#1F5132',
                                color: '#fff',
                                fontSize: '0.65rem',
                                fontWeight: 800
                              }}
                            >
                              {number}
                            </span>
                          </td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{String(s.timestamp || '').replace('T', ' ').slice(5, 16)}</td>
                          <td style={{ padding: '4px 6px 4px 0' }}>
                            <span title={s.location_source === 'OPERATOR_MAP' ? 'Operator selected on the map' : s.location_source === 'MISSION_PIN' ? 'Operator selected an existing mission pin' : s.location_source === 'UNLOCATED' ? 'GPS unavailable and no manual location assigned' : 'Measured GPS or historical sample'}
                              style={{ color: ['OPERATOR_MAP', 'MISSION_PIN'].includes(s.location_source) ? '#b45309' : 'var(--text-muted)', fontWeight: ['OPERATOR_MAP', 'MISSION_PIN'].includes(s.location_source) ? 700 : 400 }}>
                              {s.location_source === 'OPERATOR_MAP' ? 'Manual map' : s.location_source === 'MISSION_PIN' ? 'Manual pin' : s.location_source === 'UNLOCATED' ? 'Unlocated' : s.location_source === 'GPS' ? 'GPS' : 'Legacy'}
                            </span>
                          </td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{fmt(s.moisture, 1)}</td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{fmt(s.ph, 2)}</td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{fmt(s.ec, 2)}</td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{fmt(s.n, 0)}</td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{fmt(s.p, 0)}</td>
                          <td style={{ padding: '4px 6px 4px 0' }}>{fmt(s.k, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {numberedSamples.length > 100 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', paddingTop: '6px' }}>Showing the latest 100 of {numberedSamples.length}. Older samples keep their numbers on the map.</p>
                )}
                {showRawPackets && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--card-border)', paddingTop: 8 }}>
                    <strong style={{ fontSize: '0.79rem' }}>Raw mission sensor packets — {rawPacketsLoading ? 'loading…' : `${rawPackets.length} recorded`}</strong>
                    <p style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>Original packets including the first five seconds and interrupted insertions. Final averages are separate in the table above. Refresh by closing and reopening this view.</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                      <thead><tr>{['Session', 'Received', 'Moisture', 'EC (µS/cm)', 'pH', 'N / P / K'].map(h=><th key={h} style={{ textAlign: 'left', padding: 4 }}>{h}</th>)}</tr></thead>
                      <tbody>{rawPackets.slice(-50).reverse().map(r=><tr key={r.id} style={{ borderTop: '1px solid var(--card-border)' }}>
                        <td style={{ padding: 4 }} title={r.session_id}>{String(r.session_id).slice(0,8)}</td>
                        <td style={{ padding: 4 }}>{String(r.received_at || '').slice(11,19)} UTC</td>
                        <td style={{ padding: 4 }}>{fmt(r.moisture,1)}%</td>
                        <td style={{ padding: 4 }}>{fmt(r.ec,1)}</td>
                        <td style={{ padding: 4 }}>{fmt(r.ph,2)}</td>
                        <td style={{ padding: 4 }}>{[r.nitrogen,r.phosphorus,r.potassium].map(v=>fmt(v,0)).join(' / ')}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Field Modal */}
      {isFieldModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="ui-dialog" style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Add Field</h3>
              <button onClick={() => setIsFieldModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {fieldError && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fee2e2', color: '#991b1b', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={14} />
                <span>{fieldError}</span>
              </div>
            )}

            <div>
              <label style={labelStyle}>Field Name</label>
              <input
                type="text"
                autoFocus
                placeholder="e.g., UST Field"
                value={newFieldName}
                onChange={(e) => { setNewFieldName(e.target.value); setFieldError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFieldModalNext(); }}
                style={inputStyle}
              />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '6px' }}>
                Next, click around the field on the map to draw its boundary. You can then save the field, or go straight on to a mission.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="badge" onClick={() => setIsFieldModalOpen(false)} style={{ cursor: 'pointer' }}>Cancel</button>
              <button
                className="badge"
                disabled={!newFieldName.trim()}
                onClick={handleFieldModalNext}
                style={{ background: newFieldName.trim() ? 'var(--primary-green)' : '#ccc', color: '#fff', cursor: newFieldName.trim() ? 'pointer' : 'not-allowed' }}
              >
                Next: Draw Field Boundary
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start Mission Modal */}
      {isMissionModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="ui-dialog" style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '480px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Create New Mission</h3>
              <button onClick={() => setIsMissionModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {fieldError && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fee2e2', color: '#991b1b', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={14} />
                <span>{fieldError}</span>
              </div>
            )}

            <div>
              <label style={labelStyle}>Mission Name</label>
              <input
                type="text"
                placeholder="e.g., UST Field October Scan"
                value={newMission.name}
                onChange={(e) => setNewMission({ ...newMission, name: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={labelStyle}>Field</label>
                {fields.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setIsManagingFields(!isManagingFields); setFieldError(null); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--primary-green)', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {isManagingFields ? 'Done Managing' : 'Manage Fields'}
                  </button>
                )}
              </div>

              {!isManagingFields ? (
                fields.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '6px' }}>No fields yet. Add one first.</p>
                ) : (
                  <select
                    value={newMission.fieldId}
                    onChange={(e) => setNewMission((prev) => ({ ...prev, ...pinDefaultsFor(e.target.value) }))}
                    style={inputStyle}
                  >
                    {fields.map((f) => (
                      <option key={f.id} value={String(f.id)}>{f.name}{hasBoundary(f) ? '' : ' (no boundary yet)'}</option>
                    ))}
                  </select>
                )
              ) : (
                <div style={{ marginTop: '8px', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '10px', background: 'var(--bg-main)', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
                  {fields.map((f) => {
                    const used = f.missionCount > 0;
                    const isEditing = editingFieldId === f.id;
                    return (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#fff', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                            <input
                              type="text"
                              value={editFieldInput}
                              onChange={(e) => setEditFieldInput(e.target.value)}
                              style={{ flex: 1, padding: '2px 6px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--card-border)' }}
                            />
                            <button type="button" onClick={() => handleSaveEditField(f)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary-green)' }}>
                              <Check size={14} />
                            </button>
                            <button type="button" onClick={() => setEditingFieldId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span style={{ fontWeight: 500 }}>
                              {f.name} {used && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>({f.missionCount} missions)</span>}
                            </span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button type="button" onClick={() => { setEditingFieldId(f.id); setEditFieldInput(f.name); setFieldError(null); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteField(f)}
                                disabled={used}
                                style={{ background: 'transparent', border: 'none', cursor: used ? 'not-allowed' : 'pointer', color: used ? '#cbd5e1' : '#ef4444' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => { setIsMissionModalOpen(false); openFieldModal(); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--primary-green)', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', padding: 0, marginTop: '8px' }}
              >
                Field not listed? Add a new field
              </button>
            </div>

            <div>
              <label style={labelStyle}>Scheduled Date</label>
              <input
                type="date"
                value={newMission.date}
                onChange={(e) => setNewMission({ ...newMission, date: e.target.value })}
                style={inputStyle}
              />
            </div>

            {selectedModalField && (
              <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-main)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {!hasBoundary(selectedModalField) ? (
                  <span>This field has no saved boundary yet. You will draw it next, and later missions will reuse it.</span>
                ) : (
                  <>
                    <span style={{ fontWeight: 700 }}>Boundary: same as the saved one for {selectedModalField.name}</span>

                    {modalPinSources.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>No earlier pins on this field. You will place them on the map.</span>
                    ) : (
                      <>
                        {modalPinSources.length > 1 && (
                          <select
                            aria-label="Pins from mission"
                            value={modalSource ? String(modalSource.id) : ''}
                            onChange={(e) => setNewMission((prev) => ({ ...prev, pinSourceId: e.target.value }))}
                            style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.78rem' }}
                          >
                            {modalPinSources.map((m) => (
                              <option key={m.id} value={String(m.id)}>Pins from: {m.date} · {m.name} ({m.waypoints.length})</option>
                            ))}
                          </select>
                        )}

                        {[
                          { value: 'reuse', label: `Use the same ${modalSource?.waypoints.length} pins${modalPinSources.length === 1 ? ` from "${modalSource?.name}"` : ''}` },
                          { value: 'modify', label: 'Start from those pins and edit them' },
                          { value: 'new', label: 'Place new pins' }
                        ].map((option) => (
                          <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="pinsMode"
                              checked={newMission.pinsMode === option.value}
                              onChange={() => setNewMission((prev) => ({ ...prev, pinsMode: option.value, pinSourceId: prev.pinSourceId || String(modalSource.id) }))}
                            />
                            {option.label}
                          </label>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button className="badge" onClick={() => setIsMissionModalOpen(false)} style={{ cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                className="badge"
                disabled={!canProceedMission}
                onClick={handleMissionModalNext}
                style={{ background: canProceedMission ? 'var(--primary-green)' : '#ccc', color: '#fff', cursor: canProceedMission ? 'pointer' : 'not-allowed' }}
              >
                {missionNextLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
