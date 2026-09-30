import React, { useState, useEffect, useMemo } from 'react';
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
  CheckCircle2
} from 'lucide-react';
import HeatmapMap from '../components/HeatmapMap';
import OperatorNavGuide from '../components/OperatorNavGuide';
import { isPointInPolygon, calculatePolygonArea, calculateDistance } from '../utils/geo';
import {
  saveSoilSample,
  fetchMissionSamples,
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
import { hasBoundary } from '../utils/fieldGeo';

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
const todayLocal = () => new Date().toLocaleDateString('en-CA');
const blankMission = () => ({ name: '', fieldId: '', date: todayLocal(), pinsMode: 'new', pinSourceId: '' });

const fmt = (value, decimals = 1) => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : '--';
};

const TREND_STYLE = {
  up: { symbol: '▲', color: '#0369a1' },
  down: { symbol: '▼', color: '#c2410c' },
  stable: { symbol: '•', color: 'var(--text-muted)' },
  none: { symbol: '–', color: 'var(--text-muted)' }
};
const layerConfigurations = {
  overall: {
    label: 'Overall Soil Health',
    unit: 'Score / 100',
    gradient: {
      0.2: '#dc2626',
      0.4: '#ea580c',
      0.6: '#eab308',
      0.8: '#84cc16',
      1.0: '#15803d'
    },
    ranges: [
      { color: '#15803d', label: '85 - 100', desc: 'Optimal Fertility' },
      { color: '#84cc16', label: '70 - 84', desc: 'Good Condition' },
      { color: '#eab308', label: '55 - 69', desc: 'Moderate / Caution' },
      { color: '#ea580c', label: '40 - 54', desc: 'Low Nutrient' },
      { color: '#dc2626', label: '< 40', desc: 'Critical / Degraded' }
    ],
    extractValue: (s) => (s.overall || 50) / 100
  },
  moisture: {
    label: 'Soil Moisture',
    unit: '%',
    gradient: {
      0.2: '#ef4444',
      0.4: '#f97316',
      0.7: '#22c55e',
      1.0: '#0284c7'
    },
    ranges: [
      { color: '#0284c7', label: '> 60%', desc: 'Saturated / Wet' },
      { color: '#22c55e', label: '40% - 55%', desc: 'Optimal Moisture' },
      { color: '#f97316', label: '25% - 39%', desc: 'Low / Drying' },
      { color: '#ef4444', label: '< 25%', desc: 'Deficient / Very Dry' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, ((s.moisture || 0) - 20) / 50))
  },
  ph: {
    label: 'Soil pH Level',
    unit: 'pH',
    gradient: {
      0.2: '#dc2626',
      0.5: '#eab308',
      0.8: '#16a34a',
      1.0: '#7c3aed'
    },
    ranges: [
      { color: '#7c3aed', label: '> 7.5', desc: 'Alkaline' },
      { color: '#16a34a', label: '6.3 - 7.0', desc: 'Optimal Neutral' },
      { color: '#eab308', label: '5.8 - 6.2', desc: 'Slightly Acidic' },
      { color: '#dc2626', label: '< 5.5', desc: 'Strongly Acidic' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, ((s.ph || 7) - 4.5) / 4.0))
  },
  npk: {
    label: 'NPK Compound Ratio',
    unit: 'mg/kg',
    gradient: {
      0.2: '#dc2626',
      0.5: '#d97706',
      0.8: '#15803d',
      1.0: '#1e40af'
    },
    ranges: [
      { color: '#1e40af', label: 'High', desc: 'Rich / Excessive NPK' },
      { color: '#15803d', label: 'Balanced', desc: 'Optimal Macronutrients' },
      { color: '#d97706', label: 'Low', desc: 'Nutrient Depleted' },
      { color: '#dc2626', label: 'Deficient', desc: 'Severe Shortage' }
    ],
    extractValue: (s) => Math.min(1.0, Math.max(0.1, ((s.n || 0) + (s.p || 0) + (s.k || 0)) / 160))
  }
};

export default function FieldMapView() {
  const [fields, setFields] = useState([]);
  const [missions, setMissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fieldFilter, setFieldFilter] = useState('ALL'); // 'ALL' or a field id (as string)
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const [selectedLayerKey, setSelectedLayerKey] = useState('overall');

  // Mission Logging Telemetry State Machine
  const [missionState, setMissionState] = useState('IDLE'); // IDLE, IN_PROGRESS, PAUSED, FINISHED
  const [liveSamples, setLiveSamples] = useState([]);
  const [baselineSamples, setBaselineSamples] = useState([]);
  const [compareToId, setCompareToId] = useState(null); // null = previous mission of the same field
  const [lastSampleCoord, setLastSampleCoord] = useState(null);

  // Live Rover Telemetry
  const [roverPos, setRoverPos] = useState([14.6094, 120.9896]);
  const [roverHeading] = useState(45);
  const [currentWaypointIdx, setCurrentWaypointIdx] = useState(0);

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

  const activeConfig = layerConfigurations[selectedLayerKey];

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

  // Frame the map on the field (or, for legacy fields with no boundary, on its samples).
  // Memoized so the map only re-fits when the selection changes, not on every render.
  const focusPoints = useMemo(() => {
    if (wizardStep === 'DRAWING_BOUNDARY') return EMPTY;
    if (activeBoundary.length > 0) return activeBoundary;
    const coords = liveSamples.map((s) => [s.lat, s.lng]).filter(([a, b]) => a != null && b != null);
    return coords.length > 0 ? coords : EMPTY;
  }, [wizardStep, activeBoundary, liveSamples]);

  const heatPointsForLayer = useMemo(
    () => liveSamples.map((s) => [s.lat || s.coords?.[0], s.lng || s.coords?.[1], activeConfig.extractValue(s)]),
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
    setSelectedMissionId(id);
    setCompareToId(null);
    setCurrentWaypointIdx(0);
    setLastSampleCoord(null);
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

  // ---------- Tauri serial/sensor live data listener ----------
  useEffect(() => {
    const unlistenPromise = listen('sensor-data', async (event) => {
      const data = event.payload;
      if (data.error) return;

      // Always update latest real-time readings for the telemetry monitor card
      setLatestSensorData(data);

      // Only save while logging is active on an in-progress mission
      if (missionState !== 'IN_PROGRESS' || !currentSelected || currentSelected.status !== 'in_progress') return;

      const hasFix = data.lat && (data.lat !== 0 || data.lng !== 0);
      const isProbeInserted = data.soilValid === 1;

      if (hasFix && isProbeInserted) {
        const currentCoord = [data.lat, data.lng];

        if (activeBoundary.length >= 3 && !isPointInPolygon(currentCoord, activeBoundary)) {
          return;
        }

        if (lastSampleCoord) {
          const distance = calculateDistance(lastSampleCoord, currentCoord);
          if (distance < 5) return;
        }

        const newSample = {
          mission_id: String(currentSelected.id),
          plot: currentSelected.fieldName,
          coords: currentCoord,
          lat: data.lat,
          lng: data.lng,
          moisture: data.moisture,
          ph: data.ph,
          ec: data.ec,
          n: data.nitrogen,
          p: data.phosphorus,
          k: data.potassium,
          overall: Math.round((data.moisture + data.ph * 10) / 2),
          timestamp: new Date().toISOString()
        };

        const saved = await saveSoilSample(newSample);
        if (!saved) {
          setNotification({ type: 'error', message: 'A sample could not be saved to the database.' });
          return;
        }

        setLiveSamples((prev) => [...prev, newSample]);
        setFieldSamples((prev) => [...prev, newSample]); // keep the field-wide average current while logging
        setMissions((prev) => prev.map((m) => (m.id === currentSelected.id ? { ...m, sampleCount: m.sampleCount + 1 } : m)));
        setLastSampleCoord(currentCoord);
        setRoverPos(currentCoord);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [missionState, currentSelected, activeBoundary, lastSampleCoord]);

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
    setLastSampleCoord(null);
    setCurrentWaypointIdx(0);
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
    setMissionState('FINISHED');
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

  const handleAdvanceWaypoint = () => {
    const activePins = wizardStep !== 'IDLE' ? tempWaypoints : currentSelected?.waypoints || [];
    if (currentWaypointIdx < activePins.length - 1) {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx((prev) => prev + 1);
    } else {
      setRoverPos(activePins[currentWaypointIdx]);
      setCurrentWaypointIdx(activePins.length);
    }
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

  return (
    <div className="field-map-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>
      {/* Top Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Field Map & Heatmap Analysis</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Multi-variable GIS heatmap layers, bounded spatial interpolation, and real-time telemetry updates.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
              <button className="badge" style={{ cursor: 'pointer', padding: '8px 16px', border: '1px solid var(--primary-green)', color: 'var(--primary-green)', background: '#fff' }} onClick={openFieldModal}>
                <MapPin size={16} /> Add Field
              </button>
              <button className="badge" style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', padding: '8px 16px' }} onClick={() => openMissionModal()}>
                <Plus size={16} /> Start New Mission
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notification Alert */}
      {notification && (
        <div style={{
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
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1.9fr 1.35fr', gap: '14px', flex: 1, minHeight: 0 }}>
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
                    <div
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
                    </div>
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
                      onClick={() => setMissionState('PAUSED')}
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
                  <option value="overall">Overall Soil Health</option>
                  <option value="moisture">Soil Moisture</option>
                  <option value="ph">Soil pH</option>
                  <option value="npk">NPK Ratio</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            <HeatmapMap
              center={DEFAULT_CENTER}
              zoom={18}
              boundary={activeBoundary}
              waypoints={displayedWaypoints}
              heatPoints={heatPointsForLayer}
              focusPoints={focusPoints}
              roverPos={roverPos}
              onMapClick={handleMapClick}
              interactionMode={
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
            </div>
          </div>
        </div>

        {/* Right Column: Overview, Telemetry, Traversal, History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
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
                      <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{fmt(overview.avg.ec, 2)}{overview.avg.ec !== null ? ' dS/m' : ''}</div>
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
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>EC (dS/m)</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                    {latestSensorData.ec}
                  </div>
                </div>
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

          <div style={{ flex: 1, minHeight: '190px' }}>
            <OperatorNavGuide
              roverPos={roverPos}
              roverHeading={roverHeading}
              waypoints={displayedWaypoints}
              currentWaypointIdx={currentWaypointIdx}
              onAdvanceWaypoint={handleAdvanceWaypoint}
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
                      { key: 'ec', label: 'Avg. EC', decimals: 2, unit: ' dS/m' },
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

                <div style={{ borderTop: '1px solid var(--card-border)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileText size={14} color="var(--primary-green)" />
                      Amendments & Treatments
                    </span>
                    <button
                      className="badge"
                      onClick={() => setIsAddingAmendment(!isAddingAmendment)}
                      style={{ background: 'var(--primary-green)', color: '#fff', cursor: 'pointer', border: 'none', padding: '4px 10px' }}
                    >
                      <Plus size={13} /> Add Record
                    </button>
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
              </div>
            </div>
          )}

          {/* Raw samples of the selected mission */}
          {currentSelected && wizardStep === 'IDLE' && (
            <div className="card" style={{ flexShrink: 0 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="card-title">Mission Samples</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{liveSamples.length} samples</span>
              </div>
              <div style={{ maxHeight: '240px', overflow: 'auto', padding: '0 12px 10px' }}>
                {liveSamples.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '10px' }}>No samples recorded for this mission yet.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)', position: 'sticky', top: 0, background: '#fff' }}>
                        {['Time', 'Moist', 'pH', 'EC', 'N', 'P', 'K'].map((h) => (
                          <th key={h} style={{ padding: '6px 6px 6px 0', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...liveSamples].reverse().slice(0, 100).map((s, i) => (
                        <tr key={s.id ?? i} style={{ borderTop: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '4px 6px 4px 0' }}>{String(s.timestamp || '').replace('T', ' ').slice(5, 16)}</td>
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
                {liveSamples.length > 100 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', paddingTop: '6px' }}>Showing the latest 100 of {liveSamples.length}.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Field Modal */}
      {isFieldModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
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
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '480px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
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