import React, {
  useState,
  useEffect,
  useMemo,
  useRef
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  LayoutDashboard,
  Map as MapIcon,
  ClipboardList,
  Sprout,
  BarChart3,
  Settings,
  Droplets,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Radio,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  GitMerge,
  HardDrive
} from 'lucide-react';

import HeatmapMap from './components/HeatmapMap';
import FieldMapView from './views/FieldMapView';
import CropAssessmentView from './views/CropAssessmentView';
import ReportsView from './views/ReportsView';
import TileManagerView from './views/TileManagerView';
import { useDownloadPercent } from './hooks/useDownloadJob';
import { calculateDistanceMeters } from './utils/geo';

import {
  initDatabase,
  exportTelemetryPackage,
  importTelemetryPackage,
  mergeDatabaseFiles,
  getDatabaseStatus
} from './services/db';

import './App.css';

const STALE_TIMEOUT_MS = 15000;
const HISTORICAL_ASSESSMENT_MIN = 10;
const HISTORICAL_SELECTION_MAX = 20;
const HISTORICAL_MATCH_RADIUS_M = 100;
const HISTORICAL_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const RECENT_SESSION_START_ID_KEY =
  'eksplorador.recentSessionStartId';

const RECENT_SESSION_ROWS_KEY =
  'eksplorador.recentSessionRows';

const RECENT_GENERATION_KEY =
  'eksplorador.databaseGeneration';

const readSessionRows = () => {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(RECENT_SESSION_ROWS_KEY) || '[]'
    );

    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const parseTelemetryTime = timestamp => {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ''
  ) {
    return null;
  }

  if (typeof timestamp === 'string') {
    const timeOnlyMatch = timestamp
      .trim()
      .match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);

    if (timeOnlyMatch) {
      const [
        ,
        hours,
        minutes,
        seconds,
        fraction = '0'
      ] = timeOnlyMatch;

      const milliseconds = Number(`0.${fraction}`) * 1000;

      return {
        value:
          Number(hours) * 60 * 60 * 1000 +
          Number(minutes) * 60 * 1000 +
          Number(seconds) * 1000 +
          milliseconds,
        timeOnly: true
      };
    }
  }

  const normalized =
    typeof timestamp === 'string'
      ? timestamp.replace(' ', 'T')
      : timestamp;

  const time = new Date(normalized).getTime();

  return Number.isFinite(time)
    ? { value: time, timeOnly: false }
    : null;
};

const calculateTimeDifference = (
  firstTimestamp,
  secondTimestamp
) => {
  const first = parseTelemetryTime(firstTimestamp);
  const second = parseTelemetryTime(secondTimestamp);

  if (
    !first ||
    !second ||
    first.timeOnly !== second.timeOnly
  ) {
    return Infinity;
  }

  const difference = Math.abs(
    first.value - second.value
  );

  return first.timeOnly
    ? Math.min(difference, ONE_DAY_MS - difference)
    : difference;
};

const hasValidSavedLocation = record => {
  if (
    !record ||
    [record.latitude, record.longitude].some(
      value =>
        value === null ||
        value === undefined ||
        value === ''
    )
  ) {
    return false;
  }

  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    (latitude !== 0 || longitude !== 0)
  );
};

const hasLiveGpsFix = data => {
  if (
    !data ||
    !Number.isInteger(Number(data.satsLocked)) ||
    Number(data.satsLocked) <= 0
  ) {
    return false;
  }

  if (
    [data.lat, data.lng].some(
      value =>
        value === null ||
        value === undefined ||
        value === ''
    )
  ) {
    return false;
  }

  const latitude = Number(data.lat);
  const longitude = Number(data.lng);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    (latitude !== 0 || longitude !== 0)
  );
};

const normalizeHeatValue = (value, min, max) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const normalized = Math.max(
    0,
    Math.min(1, (numericValue - min) / (max - min))
  );

  return 0.2 + normalized * 0.8;
};

const LAYER_CONFIG = {
  moisture: {
    extract: row =>
      normalizeHeatValue(row.moisture, 20, 70),
    gradient: {
      0.2: '#ef4444',
      0.4: '#f97316',
      0.7: '#22c55e',
      1.0: '#0284c7'
    }
  },
  ph: {
    extract: row =>
      normalizeHeatValue(row.ph, 4.5, 8.5),
    gradient: {
      0.2: '#dc2626',
      0.5: '#eab308',
      0.8: '#16a34a',
      1.0: '#7c3aed'
    }
  },
  ec: {
    extract: row =>
      normalizeHeatValue(row.ec, 0, 4),
    gradient: {
      0.2: '#dc2626',
      0.4: '#ea580c',
      0.6: '#eab308',
      0.8: '#84cc16',
      1.0: '#15803d'
    }
  },
  nitrogen: {
    extract: row =>
      normalizeHeatValue(row.nitrogen, 0, 60),
    gradient: {
      0.2: '#dc2626',
      0.5: '#d97706',
      0.8: '#15803d',
      1.0: '#1e40af'
    }
  },
  phosphorus: {
    extract: row =>
      normalizeHeatValue(row.phosphorus, 0, 80),
    gradient: {
      0.2: '#dc2626',
      0.5: '#d97706',
      0.8: '#15803d',
      1.0: '#1e40af'
    }
  },
  potassium: {
    extract: row =>
      normalizeHeatValue(row.potassium, 0, 100),
    gradient: {
      0.2: '#dc2626',
      0.5: '#d97706',
      0.8: '#15803d',
      1.0: '#1e40af'
    }
  }
};

function TelemetrySyncBar({
  onImportSuccess,
  onTransferState
}) {
  const [total, setTotal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [databaseError, setDatabaseError] = useState('');

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const status = await getDatabaseStatus();

        if (active) {
          setTotal(status.total);
          setDatabaseError('');
        }
      } catch (error) {
        if (active) {
          setTotal(null);
          setDatabaseError(
            String(error.message || error)
          );
        }
      }
    };

    refresh();

    const interval = setInterval(refresh, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const run = async mode => {
    setBusy(true);

    if (mode !== 'export') {
      onTransferState(true);
    }

    try {
      const result =
        mode === 'export'
          ? await exportTelemetryPackage()
          : mode === 'merge'
            ? await mergeDatabaseFiles()
            : await importTelemetryPackage();

      if (result.cancelled) {
        return;
      }

      if (mode === 'export') {
        alert(
          `Export Successful!\nFull database saved to:\n${result.path}`
        );
      } else {
        onImportSuccess(result);

        alert(
          mode === 'merge'
            ? (
                `Merge Successful!\n${result.added} records added; ` +
                `${result.skipped} already present.` +
                (
                  result.renamed
                    ? `\n${result.renamed} conflicting crop names were given a merged suffix.`
                    : ''
                )
              )
            : (
                `Import Successful!\nDatabase replaced with ` +
                `${result.count} records across all tables.`
              )
        );
      }
    } catch (error) {
      const action =
        mode === 'export'
          ? 'Export'
          : mode === 'merge'
            ? 'Merge'
            : 'Import';

      alert(
        `${action} Failed: ${error.message || error}`
      );
    } finally {
      if (mode !== 'export') {
        onTransferState(false);
      }

      setBusy(false);

      try {
        const status = await getDatabaseStatus();
        setTotal(status.total);
      } catch {
        setTotal(null);
      }
    }
  };

  const buttonStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px'
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8
      }}
    >
      <button
        type="button"
        className="badge"
        onClick={() => run('export')}
        disabled={busy || !total}
        title={
          total
            ? `Export all ${total} database records`
            : databaseError ||
              'The database is empty or loading'
        }
        style={{
          ...buttonStyle,
          background: 'var(--primary-green)',
          color: '#fff',
          opacity: busy || !total ? 0.55 : 1
        }}
      >
        <Upload size={14} />
        Export Data
      </button>

      <button
        type="button"
        className="badge"
        disabled={busy || total === null}
        title="Replace the whole database from one backup"
        onClick={() => run('import')}
        style={buttonStyle}
      >
        <Download size={14} />
        Import Data
      </button>

      <button
        type="button"
        className="badge"
        disabled={busy || total === null}
        title="Combine one or more backups with the current database"
        onClick={() => run('merge')}
        style={buttonStyle}
      >
        <GitMerge size={14} />
        Merge Data
      </button>

      {busy && (
        <span role="status">Working…</span>
      )}

      {databaseError && (
        <span
          role="alert"
          style={{
            color: '#b91c1c',
            maxWidth: 400
          }}
        >
          {databaseError}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  // -1 when no map download is running, else 0-100 (drives the sidebar badge)
  const downloadPercent = useDownloadPercent();
  const [selectedLayer, setSelectedLayer] = useState('ph');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const lastPacketTime = useRef(null);

  // Recent rows are session-specific.
  // Database records remain stored independently of this table.
  const [telemetryData, setTelemetryData] =
    useState(readSessionRows);

  const sessionStartId = useRef(null);
  const transferInProgress = useRef(false);
  const pollEpoch = useRef(0);
  const databaseGeneration = useRef(null);

  const [
    selectedHistoricalRecords,
    setSelectedHistoricalRecords
  ] = useState([]);

  const [
    assessedHistoricalRecords,
    setAssessedHistoricalRecords
  ] = useState([]);

  const [
    rawLiveReadings,
    setRawLiveReadings
  ] = useState([]);

  const activeLayerConfig =
    LAYER_CONFIG[selectedLayer] ?? LAYER_CONFIG.ph;

  const liveHeatPoints = rawLiveReadings
    .map(reading => [
      reading.lat,
      reading.lng,
      activeLayerConfig.extract(reading)
    ])
    .filter(point => point[2] !== null);

  const selectedHistoricalHeatPoints = useMemo(
    () =>
      selectedHistoricalRecords
        .map(record => [
          record.latitude,
          record.longitude,
          activeLayerConfig.extract(record)
        ])
        .filter(point => point[2] !== null),
    [
      selectedHistoricalRecords,
      activeLayerConfig
    ]
  );

  const displayedHeatPoints =
    selectedHistoricalRecords.length > 0
      ? selectedHistoricalHeatPoints
      : liveHeatPoints;

  const selectedHistoricalPositions = useMemo(
    () =>
      selectedHistoricalRecords.map(record => [
        record.latitude,
        record.longitude
      ]),
    [selectedHistoricalRecords]
  );

  const historicalMapMarkers = useMemo(
    () =>
      selectedHistoricalRecords.length > 0
        ? [
            {
              lat: selectedHistoricalRecords[0].latitude,
              lng: selectedHistoricalRecords[0].longitude,
              label: 1,
              isAnchor: true
            }
          ]
        : [],
    [selectedHistoricalRecords]
  );

  const selectedHistoricalPos =
    selectedHistoricalPositions.length > 0
      ? selectedHistoricalPositions[
          selectedHistoricalPositions.length - 1
        ]
      : null;

  const cropSuitability = useMemo(() => {
    const usingHistory =
      assessedHistoricalRecords.length >=
      HISTORICAL_ASSESSMENT_MIN;

    const sourceRecords = usingHistory
      ? assessedHistoricalRecords
      : liveData && liveData.soilValid === 1
        ? [liveData]
        : [];

    if (sourceRecords.length === 0) {
      return null;
    }

    const average = key => {
      const values = sourceRecords
        .map(record => record[key])
        .filter(
          value =>
            value !== null &&
            value !== undefined &&
            value !== '' &&
            Number.isFinite(Number(value))
        )
        .map(Number);

      return values.length > 0
        ? values.reduce(
            (sum, value) => sum + value,
            0
          ) / values.length
        : null;
    };

    const ph = average('ph');
    const moisture = average('moisture');
    const nitrogen = average('nitrogen');
    const phosphorus = average('phosphorus');
    const potassium = average('potassium');

    const recommendedCrops = [];

    if (
      ph !== null &&
      moisture !== null &&
      ph >= 5.5 &&
      ph <= 6.8 &&
      moisture >= 35
    ) {
      recommendedCrops.push('Rice');
    }

    if (
      ph !== null &&
      moisture !== null &&
      ph >= 5.0 &&
      ph <= 7.5 &&
      moisture >= 40
    ) {
      recommendedCrops.push('Cacao');
    }

    if (
      ph !== null &&
      moisture !== null &&
      ph >= 5.0 &&
      ph <= 6.5 &&
      moisture >= 30
    ) {
      recommendedCrops.push('Coffee');
    }

    const formatValue = value =>
      value === null ? '--' : value.toFixed(1);

    return {
      recommendedCrops,
      sourceLabel: usingHistory
        ? (
            `average of ${sourceRecords.length} selected ` +
            `historical record${sourceRecords.length === 1 ? '' : 's'}`
          )
        : 'current live reading',
      ph: formatValue(ph),
      nitrogen: formatValue(nitrogen),
      phosphorus: formatValue(phosphorus),
      potassium: formatValue(potassium)
    };
  }, [
    assessedHistoricalRecords,
    liveData
  ]);

  const selectHistoricalGroup = anchorRecord => {
    if (!hasValidSavedLocation(anchorRecord)) {
      return;
    }

    const anchorPosition = [
      anchorRecord.latitude,
      anchorRecord.longitude
    ];

    const relatedRecords = telemetryData
      .filter(
        record =>
          record.id !== anchorRecord.id &&
          hasValidSavedLocation(record)
      )
      .map(record => {
        const timeDifference = calculateTimeDifference(
          anchorRecord.timestamp,
          record.timestamp
        );

        const distance = calculateDistanceMeters(
          anchorPosition,
          [
            record.latitude,
            record.longitude
          ]
        );

        return {
          record,
          timeDifference,
          distance
        };
      })
      .filter(
        ({ timeDifference, distance }) =>
          timeDifference <= HISTORICAL_MATCH_WINDOW_MS &&
          distance <= HISTORICAL_MATCH_RADIUS_M
      )
      .sort(
        (first, second) =>
          first.timeDifference - second.timeDifference ||
          first.distance - second.distance
      )
      .slice(0, HISTORICAL_SELECTION_MAX - 1)
      .map(({ record }) => record);

    setAssessedHistoricalRecords([]);

    setSelectedHistoricalRecords([
      anchorRecord,
      ...relatedRecords
    ]);
  };

  const clearHistoricalSelection = () => {
    setSelectedHistoricalRecords([]);
    setAssessedHistoricalRecords([]);
  };

  const latestLocatedRecord = telemetryData.find(
    hasValidSavedLocation
  );

  const latestDbPos = latestLocatedRecord
    ? [
        Number(latestLocatedRecord.latitude),
        Number(latestLocatedRecord.longitude)
      ]
    : null;

  useEffect(() => {
    const unlisten = listen('sensor-data', event => {
      const data = event.payload;

      if (data.error) {
        console.warn(
          'Receiver reported an error:',
          data.error
        );
        return;
      }

      if (
        hasLiveGpsFix(data) &&
        data.soilValid === 1
      ) {
        setRawLiveReadings(previous =>
          [
            ...previous,
            {
              lat: data.lat,
              lng: data.lng,
              moisture: data.moisture,
              ph: data.ph,
              ec: data.ec,
              nitrogen: data.nitrogen,
              phosphorus: data.phosphorus,
              potassium: data.potassium
            }
          ].slice(-500)
        );
      }

      setLiveData(data);
      setIsConnected(true);
      lastPacketTime.current = Date.now();
    });

    const staleCheck = setInterval(() => {
      if (
        lastPacketTime.current &&
        Date.now() - lastPacketTime.current >
          STALE_TIMEOUT_MS
      ) {
        setIsConnected(false);
      }
    }, 2000);

    return () => {
      unlisten.then(unsubscribe => unsubscribe());
      clearInterval(staleCheck);
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        RECENT_SESSION_ROWS_KEY,
        JSON.stringify(telemetryData)
      );
    } catch (error) {
      console.warn(
        'Could not cache recent samples for refresh:',
        error
      );
    }
  }, [telemetryData]);

  useEffect(() => {
    async function loadTelemetry() {
      try {
        if (transferInProgress.current) {
          return;
        }

        const epoch = pollEpoch.current;

        await initDatabase();

        const snapshot = await invoke(
          'get_recent_telemetry'
        );

        if (
          transferInProgress.current ||
          epoch !== pollEpoch.current
        ) {
          return;
        }

        const {
          records,
          generation
        } = snapshot;

        if (!Array.isArray(records)) {
          return;
        }

        const savedGeneration = sessionStorage.getItem(
          RECENT_GENERATION_KEY
        );

        if (
          savedGeneration !== null &&
          savedGeneration !== String(generation)
        ) {
          sessionStartId.current = null;

          sessionStorage.removeItem(
            RECENT_SESSION_START_ID_KEY
          );

          setTelemetryData([]);
          clearHistoricalSelection();
        }

        databaseGeneration.current = generation;

        sessionStorage.setItem(
          RECENT_GENERATION_KEY,
          String(generation)
        );

        const latestId = Math.max(
          0,
          ...records.map(
            record => Number(record.id) || 0
          )
        );

        if (sessionStartId.current === null) {
          const savedId = sessionStorage.getItem(
            RECENT_SESSION_START_ID_KEY
          );

          sessionStartId.current =
            savedId !== null &&
            Number.isFinite(Number(savedId))
              ? Number(savedId)
              : latestId;

          sessionStorage.setItem(
            RECENT_SESSION_START_ID_KEY,
            String(sessionStartId.current)
          );
        }

        setTelemetryData(previous => {
          if (
            transferInProgress.current ||
            epoch !== pollEpoch.current ||
            generation !== databaseGeneration.current
          ) {
            return previous;
          }

          // Append only measurements collected after
          // the current session/import baseline.
          const newRows = records.filter(
            record =>
              Number(record.id) > sessionStartId.current
          );

          if (newRows.length === 0) {
            return previous;
          }

          const byId = new Map(
            previous.map(row => [
              Number(row.id),
              row
            ])
          );

          newRows.forEach(row => {
            byId.set(Number(row.id), row);
          });

          return Array.from(byId.values()).sort(
            (first, second) =>
              Number(second.id) - Number(first.id)
          );
        });
      } catch (error) {
        console.error(
          'Failed to load telemetry from Rust Backend:',
          error
        );
      }
    }

    loadTelemetry();

    const refreshInterval = setInterval(
      loadTelemetry,
      10000
    );

    return () => clearInterval(refreshInterval);
  }, []);

  const navItems = [
    {
      id: 'Dashboard',
      label: 'Live Monitoring',
      icon: LayoutDashboard
    },
    {
      id: 'Field Map',
      label: 'Field Map',
      icon: MapIcon
    },
    {
      id: 'Crop Assessment',
      label: 'Crop Assessment',
      icon: Sprout
    },
    {
      id: 'Reports',
      label: 'Reports',
      icon: BarChart3
    },
    {
      id: 'Offline Maps',
      label: 'Offline Maps',
      icon: HardDrive
    }
  ];

  const hasGpsFix =
    isConnected && hasLiveGpsFix(liveData);

  const soilOk =
    liveData && liveData.soilValid === 1;

  return (
    <div className="dashboard-layout">
      <aside
        className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}
      >
        <div>
          <div className="brand-header">
            {!isCollapsed ? (
              <>
                <div className="brand-info">
                  <Sprout
                    size={28}
                    color="#D99A2B"
                  />

                  <div>
                    <div className="brand-title">
                      EKSPLORADOR
                    </div>
                    <div className="brand-subtitle">
                      SOIL MONITORING
                    </div>
                  </div>
                </div>

                <button
                  className="sidebar-toggle-btn"
                  onClick={() => setIsCollapsed(true)}
                  title="Collapse Sidebar"
                >
                  <ChevronLeft size={18} />
                </button>
              </>
            ) : (
              <button
                className="sidebar-toggle-btn"
                onClick={() => setIsCollapsed(false)}
                title="Expand Sidebar"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          <nav className="nav-list">
            {navItems.map(item => {
              const Icon = item.icon;

              return (
                <div
                  key={item.id}
                  className={
                    `nav-item ${
                      activeTab === item.id ? 'active' : ''
                    }`
                  }
                  onClick={() => setActiveTab(item.id)}
                  title={
                    item.id === 'Offline Maps' && downloadPercent >= 0
                      ? `Map download ${downloadPercent}%`
                      : isCollapsed ? item.label : ''
                  }
                  style={item.id === 'Offline Maps' ? { position: 'relative' } : undefined}
                >
                  <Icon size={20} />

                  {!isCollapsed && (
                    <span className="nav-label">
                      {item.label}
                    </span>
                  )}

                  {item.id === 'Offline Maps' && downloadPercent >= 0 && (
                    isCollapsed ? (
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          background: '#D99A2B',
                          boxShadow: '0 0 0 2px #fff'
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          padding: '1px 7px',
                          borderRadius: '999px',
                          background: '#D99A2B',
                          color: '#fff'
                        }}
                      >
                        {downloadPercent}%
                      </span>
                    )
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div
          className="nav-item"
          title={isCollapsed ? 'Settings' : ''}
        >
          <Settings size={20} />

          {!isCollapsed && (
            <span className="nav-label">
              Settings
            </span>
          )}
        </div>
      </aside>

      <main className="main-content">
        {activeTab === 'Field Map' ? (
          <FieldMapView />
        ) : activeTab === 'Crop Assessment' ? (
          <CropAssessmentView />
        ) : activeTab === 'Reports' ? (
          <ReportsView />
        ) : activeTab === 'Offline Maps' ? (
          <TileManagerView />
        ) : (
          <>
            <header className="top-bar">
              <div>
                <h1>Live Monitoring Board</h1>
              </div>

              <TelemetrySyncBar
                onTransferState={active => {
                  transferInProgress.current = active;
                  pollEpoch.current += 1;
                }}
                onImportSuccess={result => {
                  // A replacement database may have smaller IDs.
                  // Use its exact baseline instead of the previous
                  // database's maximum ID.
                  pollEpoch.current += 1;

                  sessionStartId.current = result.latestId;

                  databaseGeneration.current =
                    result.generation;

                  try {
                    sessionStorage.setItem(
                      RECENT_SESSION_START_ID_KEY,
                      String(result.latestId)
                    );

                    sessionStorage.setItem(
                      RECENT_GENERATION_KEY,
                      String(result.generation)
                    );

                    sessionStorage.setItem(
                      RECENT_SESSION_ROWS_KEY,
                      JSON.stringify(result.records)
                    );
                  } catch (error) {
                    console.warn(
                      'Database updated, but session cache could not be saved:',
                      error
                    );
                  }

                  clearHistoricalSelection();
                  setRawLiveReadings([]);
                  setTelemetryData(result.records);
                }}
              />

              <div className="status-badges">

                <div
                  className={
                    `badge ${
                      isConnected ? 'badge-connected' : ''
                    }`
                  }
                >
                  {isConnected ? (
                    <Wifi size={14} />
                  ) : (
                    <WifiOff size={14} />
                  )}

                  <span>
                    {isConnected
                      ? 'Rover Connected'
                      : 'Waiting for Rover'}
                  </span>
                </div>

                <div className="badge">
                  <Radio size={14} />

                  <span>
                    LoRa{' '}
                    {liveData
                      ? `(RSSI ${liveData.rssi} dBm, SNR ${liveData.snr})`
                      : ''}
                  </span>
                </div>

                <div className="badge">
                  <Navigation size={14} />

                  <span>
                    {isConnected && liveData
                      ? hasGpsFix
                        ? `GPS Fix (${liveData.satsLocked} sats)`
                        : `No Fix (${liveData.satsView} in view)`
                      : 'GPS --'}
                  </span>
                </div>

                <div className="badge">
                  {soilOk ? (
                    <CheckCircle2
                      size={14}
                      color="#1F5132"
                    />
                  ) : (
                    <AlertTriangle
                      size={14}
                      color="#B45309"
                    />
                  )}

                  <span>
                    {liveData
                      ? soilOk
                        ? 'Probe OK'
                        : 'Probe Not Responding'
                      : 'Probe --'}
                  </span>
                </div>
              </div>
            </header>

            <section className="kpi-row">
              <div className="kpi-card">
                <div className="kpi-header">
                  <div
                    className="kpi-icon-wrap"
                    style={{
                      borderColor: '#1F5132',
                      color: '#1F5132'
                    }}
                  >
                    <Droplets size={18} />
                  </div>

                  <span className="kpi-title">
                    Soil Moisture
                  </span>
                </div>

                <div className="kpi-value">
                  {soilOk
                    ? `${liveData.moisture}%`
                    : '--'}
                </div>

                <div className="kpi-status">
                  <CheckCircle2 size={13} />{' '}
                  {soilOk
                    ? 'Within range'
                    : 'No valid reading'}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <div
                    className="kpi-icon-wrap"
                    style={{
                      borderColor: '#8A5A35',
                      color: '#8A5A35'
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 800
                      }}
                    >
                      pH
                    </span>
                  </div>

                  <span className="kpi-title">
                    Soil pH
                  </span>
                </div>

                <div className="kpi-value">
                  {soilOk ? liveData.ph : '--'}
                </div>

                <div className="kpi-status">
                  <CheckCircle2 size={13} />{' '}
                  {soilOk
                    ? 'Optimal'
                    : 'No valid reading'}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <div
                    className="kpi-icon-wrap"
                    style={{
                      borderColor: '#5C3A24',
                      color: '#5C3A24'
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 800
                      }}
                    >
                      EC
                    </span>
                  </div>

                  <span className="kpi-title">
                    Conductivity (EC)
                  </span>
                </div>

                <div className="kpi-value">
                  {soilOk ? liveData.ec : '--'}{' '}
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 500
                    }}
                  >
                    uS/cm
                  </span>
                </div>

                <div className="kpi-status">
                  <CheckCircle2 size={13} />{' '}
                  {soilOk
                    ? 'Within range'
                    : 'No valid reading'}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <div
                    className="kpi-icon-wrap"
                    style={{
                      borderColor: '#D99A2B',
                      color: '#D99A2B'
                    }}
                  >
                    <Sprout size={18} />
                  </div>

                  <span className="kpi-title">
                    NPK Ratio
                  </span>
                </div>

                <div className="kpi-value">
                  {soilOk
                    ? (
                        `${liveData.nitrogen} / ` +
                        `${liveData.phosphorus} / ` +
                        `${liveData.potassium}`
                      )
                    : '-- / -- / --'}

                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 500
                    }}
                  >
                    {' '}mg/kg
                  </span>
                </div>

                <div className="kpi-status">
                  <CheckCircle2 size={13} />{' '}
                  {soilOk
                    ? 'Balanced'
                    : 'No valid reading'}
                </div>
              </div>
            </section>

            <section className="workspace-grid">
              <div className="card map-card">
                <div className="card-header">
                  <span className="card-title">
                    Field Heatmap Spatial View
                  </span>

                  <div
                    style={{
                      display: 'flex',
                      gap: '8px'
                    }}
                  >
                    <select
                      value={selectedLayer}
                      onChange={event =>
                        setSelectedLayer(event.target.value)
                      }
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--card-border)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        outline: 'none'
                      }}
                    >
                      <option value="moisture">
                        Soil Moisture
                      </option>
                      <option value="ph">
                        Soil pH
                      </option>
                      <option value="ec">
                        Electrical Conductivity
                      </option>
                      <option value="nitrogen">
                        Nitrogen (N)
                      </option>
                      <option value="phosphorus">
                        Phosphorus (P)
                      </option>
                      <option value="potassium">
                        Potassium (K)
                      </option>
                    </select>
                  </div>
                </div>

                <HeatmapMap
                  center={
                    selectedHistoricalPos ||
                    (
                      hasGpsFix
                        ? [liveData.lat, liveData.lng]
                        : latestDbPos || [14.6095, 120.9890]
                    )
                  }
                  zoom={18}
                  heatPoints={displayedHeatPoints}
                  roverPos={
                    !selectedHistoricalPos && hasGpsFix
                      ? [liveData.lat, liveData.lng]
                      : null
                  }
                  gpsWarning={
                    !hasGpsFix
                      ? !isConnected
                        ? 'Waiting for rover telemetry and GPS position.'
                        : Number(liveData?.satsLocked) === 0
                          ? '0 satellites locked. Live location is unavailable.'
                          : 'Waiting for valid GPS coordinates.'
                      : null
                  }
                  focusPoints={selectedHistoricalPositions}
                  labeledPoints={historicalMapMarkers}
                  gradient={activeLayerConfig.gradient}
                />
              </div>

              <div className="card live-sampling-card">
                <div className="card-header">
                  <span className="card-title">
                    Live Sampling Queue
                  </span>
                </div>

                <div
                  style={{
                    padding: '16px',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem'
                  }}
                >
                  {liveData ? (
                    <p>
                      Last packet #{liveData.seq} received just now.
                      {!hasGpsFix && ' Waiting for GPS fix.'}
                      {hasGpsFix && !soilOk &&
                        ' GPS locked, but soil probe reading invalid.'}
                      {hasGpsFix && soilOk &&
                        ' Plotted on the heatmap.'}
                      {' '}Samples table updates from saved records.
                    </p>
                  ) : (
                    <p>
                      Awaiting next telemetry ping from rover...
                    </p>
                  )}
                </div>
              </div>

              <div className="card recent-samples-card">
                <div className="card-header">
                  <span className="card-title">
                    Recent Geo-tagged Samples
                  </span>

                  <div className="historical-selection-controls">
                    <span
                      title={
                        `Anchor plus records within ` +
                        `${HISTORICAL_MATCH_RADIUS_M} m and ±2 hours`
                      }
                    >
                      {selectedHistoricalRecords.length}
                      /{HISTORICAL_SELECTION_MAX} related
                    </span>

                    <button
                      type="button"
                      className="assess-history-btn"
                      disabled={
                        selectedHistoricalRecords.length <
                        HISTORICAL_ASSESSMENT_MIN
                      }
                      onClick={() =>
                        setAssessedHistoricalRecords([
                          ...selectedHistoricalRecords
                        ])
                      }
                      title={
                        selectedHistoricalRecords.length <
                        HISTORICAL_ASSESSMENT_MIN
                          ? (
                              `Select at least ` +
                              `${HISTORICAL_ASSESSMENT_MIN} records ` +
                              'to assess crop suitability'
                            )
                          : 'Calculate crop suitability from the selected historical records'
                      }
                    >
                      Assess historical records
                    </button>

                    {selectedHistoricalRecords.length > 0 && (
                      <button
                        type="button"
                        className="clear-history-btn"
                        onClick={clearHistoricalSelection}
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    fontSize: '0.8rem',
                    overflowX: 'auto'
                  }}
                >
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      textAlign: 'left'
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          color: 'var(--text-muted)',
                          borderBottom:
                            '1px solid var(--card-border)'
                        }}
                      >
                        <th
                          aria-label="Select record"
                          style={{
                            padding: '6px 8px',
                            width: '32px'
                          }}
                        />

                        <th
                          style={{
                            padding: '6px 8px',
                            width: '58px'
                          }}
                        >
                          ID
                        </th>

                        <th style={{ padding: '6px 8px' }}>
                          Time
                        </th>

                        <th style={{ padding: '6px 8px' }}>
                          Lat / Lng
                        </th>

                        <th style={{ padding: '6px 8px' }}>
                          pH
                        </th>

                        <th style={{ padding: '6px 8px' }}>
                          Moisture
                        </th>

                        <th style={{ padding: '6px 8px' }}>
                          EC
                        </th>

                        <th style={{ padding: '6px 8px' }}>
                          NPK (N/P/K)
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {telemetryData.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            style={{
                              padding: '8px',
                              textAlign: 'center',
                              color: 'var(--text-muted)'
                            }}
                          >
                            No telemetry records found.
                          </td>
                        </tr>
                      ) : (
                        telemetryData.map(row => {
                          const hasSavedLocation =
                            hasValidSavedLocation(row);

                          const selectedIndex =
                            selectedHistoricalRecords.findIndex(
                              record => record.id === row.id
                            );

                          const isSelected =
                            selectedIndex >= 0;

                          const mapId = isSelected
                            ? selectedIndex + 1
                            : null;

                          return (
                            <tr
                              key={row.id}
                              className={
                                'historical-sample-row' +
                                (isSelected ? ' selected' : '') +
                                (
                                  !hasSavedLocation
                                    ? ' unavailable'
                                    : ''
                                )
                              }
                              onClick={() =>
                                selectHistoricalGroup(row)
                              }
                              onKeyDown={event => {
                                if (
                                  event.key === 'Enter' ||
                                  event.key === ' '
                                ) {
                                  event.preventDefault();
                                  selectHistoricalGroup(row);
                                }
                              }}
                              tabIndex={
                                hasSavedLocation ? 0 : -1
                              }
                              aria-selected={isSelected}
                              title={
                                !hasSavedLocation
                                  ? 'This record has no saved GPS fix'
                                  : 'Use this record as the anchor for an automatic historical group'
                              }
                              style={{
                                borderBottom: '1px solid #f1f5f9'
                              }}
                            >
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!hasSavedLocation}
                                  onChange={() =>
                                    selectHistoricalGroup(row)
                                  }
                                  onClick={event =>
                                    event.stopPropagation()
                                  }
                                  aria-label={
                                    `Select sample from ${row.timestamp}`
                                  }
                                />
                              </td>

                              <td style={{ padding: '8px' }}>
                                {mapId !== null && (
                                  <span
                                    title={
                                      mapId === 1
                                        ? 'Anchor sample'
                                        : `Related sample ${mapId}`
                                    }
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '50%',
                                      background:
                                        mapId === 1
                                          ? 'var(--accent-gold)'
                                          : 'var(--primary-green)',
                                      color: '#fff',
                                      fontSize: '0.72rem',
                                      fontWeight: 800
                                    }}
                                  >
                                    {mapId}
                                  </span>
                                )}
                              </td>

                              <td style={{ padding: '8px' }}>
                                {
                                  String(row.timestamp ?? '')
                                    .match(
                                      /\b\d{1,2}:\d{2}:\d{2}\b/
                                    )?.[0] ?? '--'
                                }
                              </td>

                              <td style={{ padding: '8px' }}>
                                {hasSavedLocation
                                  ? (
                                      `${Number(row.latitude).toFixed(5)}, ` +
                                      `${Number(row.longitude).toFixed(5)}`
                                    )
                                  : 'No fix'}
                              </td>

                              <td style={{ padding: '8px' }}>
                                {row.ph}
                              </td>

                              <td style={{ padding: '8px' }}>
                                {row.moisture}%
                              </td>

                              <td style={{ padding: '8px' }}>
                                {row.ec} uS/cm
                              </td>

                              <td style={{ padding: '8px' }}>
                                {row.nitrogen ?? '--'} /{' '}
                                {row.phosphorus ?? '--'} /{' '}
                                {row.potassium ?? '--'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card crop-suitability-card">
                <div className="card-header">
                  <span className="card-title">
                    Crop Suitability
                  </span>
                </div>

                <div
                  style={{
                    padding: '16px',
                    fontSize: '0.85rem'
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--primary-green)',
                      marginBottom: '4px'
                    }}
                  >
                    {cropSuitability
                      ? cropSuitability.recommendedCrops.length > 0
                        ? (
                            `Recommended: ` +
                            cropSuitability.recommendedCrops.join(' & ')
                          )
                        : 'No strong match among Rice, Cacao, or Coffee'
                      : 'Awaiting valid soil data'}
                  </div>

                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.8rem'
                    }}
                  >
                    {cropSuitability
                      ? (
                          `Based on the ${cropSuitability.sourceLabel}: ` +
                          `pH ${cropSuitability.ph}, ` +
                          `NPK ${cropSuitability.nitrogen} / ` +
                          `${cropSuitability.phosphorus} / ` +
                          `${cropSuitability.potassium} mg/kg.`
                        )
                      : 'Recommendations will appear once a valid soil reading is received.'}
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}