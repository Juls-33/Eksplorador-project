import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { AlertTriangle, Crosshair, Wifi, WifiOff, CloudOff, MapPin, Search, X } from 'lucide-react';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { generateIDWHeatmapGrid } from '../utils/geo';
import { fetchAllCoverage } from '../services/tileStorage';
import { searchPlaces, MIN_QUERY_LENGTH } from '../services/placeSearch';

const hasMapPosition = (position) =>
  Array.isArray(position) &&
  position.length === 2 &&
  position.every(
    (value) => value !== null && value !== undefined && value !== ''
  ) &&
  Number.isFinite(Number(position[0])) &&
  Number.isFinite(Number(position[1])) &&
  Math.abs(Number(position[0])) <= 90 &&
  Math.abs(Number(position[1])) <= 180 &&
  (Number(position[0]) !== 0 || Number(position[1]) !== 0);

// The map is locked to this box (Nueva Ecija to Batangas) via maxBounds, so
// place search must not offer results the map is unable to show.
const REGION_BOUNDS = [
  [14.05, 120.70],
  [16.05, 121.60]
];

const isInRegion = (lat, lng) =>
  lat >= REGION_BOUNDS[0][0] && lat <= REGION_BOUNDS[1][0] &&
  lng >= REGION_BOUNDS[0][1] && lng <= REGION_BOUNDS[1][1];

export default function HeatmapMap({
  center = [14.6095, 120.9895],
  zoom = 18,
  heatPoints = [],
  focusPoints = [],
  labeledPoints = [],
  roverPos = [14.6095, 120.9895],
  gpsWarning = null,
  waypoints = [],
  waypointsDeletable = false,
  onWaypointDelete = null,
  boundary = [],
  onMapClick = null,
  interactionMode = 'NONE',
  showRover = true,
  showFollowControl = true,
  gradient = {
    0.2: '#dc2626',
    0.4: '#ea580c',
    0.6: '#eab308',
    0.8: '#16a34a',
    1.0: '#15803d'
  }
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const heatLayerRef = useRef(null);
  const roverMarkerRef = useRef(null);
  const waypointLayerGroupRef = useRef(null);
  const routePolylineRef = useRef(null);
  const boundaryPolygonRef = useRef(null);
  const boundaryPointsGroupRef = useRef(null);
  const historicalLabelsGroupRef = useRef(null);

  const interactionModeRef = useRef(interactionMode);
  const onMapClickRef = useRef(onMapClick);
  const onWaypointDeleteRef = useRef(onWaypointDelete);

  useEffect(() => {
    onWaypointDeleteRef.current = onWaypointDelete;
  }, [onWaypointDelete]);

  // Tile source feedback: 'checking' | 'online' | 'offline' | 'unavailable'.
  // Tiles arrive in bursts of a dozen+ per pan/zoom, so outcomes are tallied
  // and the visible status is only recomputed a short moment after the last
  // one lands, rather than flickering on every individual tile.
  // Every downloaded/bundled offline area, for the "jump to a downloaded
  // map" dropdown — loaded once per mount, same source tileStorage.js's
  // Tile Manager uses, so this list is never a second, separately-tracked
  // copy of what's actually on disk.
  const [coverageAreas, setCoverageAreas] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchAllCoverage().then((areas) => {
      if (!cancelled) setCoverageAreas(areas);
    });
    return () => { cancelled = true; };
  }, []);

  const handleJumpToCoverageArea = (e) => {
    const index = e.target.value;
    e.target.value = ''; // reset so picking the same area twice still fires a change
    if (index === '' || !mapInstanceRef.current) return;
    const area = coverageAreas[Number(index)];
    if (!area) return;
    // Stop auto-following the rover, or the next GPS update would pan the
    // map straight back off the area just jumped to.
    followRoverRef.current = false;
    setFollowRover(false);
    const bounds = L.latLngBounds([area.south, area.west], [area.north, area.east]);
    mapInstanceRef.current.fitBounds(bounds, { padding: [24, 24], animate: true });
  };

  const [tileStatus, setTileStatus] = useState('checking');
  const tileTallyRef = useRef({ online: 0, offline: 0, failed: 0 });
  const tallyDebounceRef = useRef(null);

  // Real connectivity, kept current by an active background probe rather
  // than trusted from navigator.onLine — which can report "online" even
  // with no working internet (observed on WebView2/Windows). createTile
  // reads this synchronously, so an offline tile request goes straight to
  // the local fallback instead of waiting out an online-attempt timeout.
  const isOnlineRef = useRef(navigator.onLine);

  // Third fallback tier: tiles the user downloaded themselves through the
  // in-app Tile Manager, saved under the app's local-data directory rather
  // than the bundled /tiles/... assets. Resolved once, async, since finding
  // that directory is a Tauri IPC call — see tileStorage.js for the writer
  // side. Stays null outside Tauri (e.g. a plain browser preview) or if it
  // resolves too late for the very first tile of the session; either way
  // this tier is just skipped rather than breaking tile loading.
  const userTilesDirRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = await appLocalDataDir();
        const dir = await join(base, 'tiles');
        if (!cancelled) userTilesDirRef.current = dir;
      } catch {
        // Not running under Tauri, or the API isn't available — fine, this
        // tier just stays unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const probeConnectivity = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        // mode: 'no-cors' deliberately avoids a CORS rejection being
        // mistaken for "offline" — we only care whether the request reached
        // the network at all, not whether we can read the response.
        // cache: 'no-store' stops a stale cached hit from faking "online".
        await fetch('https://tile.openstreetmap.org/0/0/0.png', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!cancelled) isOnlineRef.current = true;
      } catch {
        if (!cancelled) isOnlineRef.current = false;
      }
    };

    probeConnectivity(); // run immediately so the very first tile already has a real answer
    const intervalId = setInterval(probeConnectivity, 7000);

    // When the browser does correctly fire these, act on them instantly
    // instead of waiting for the next probe tick.
    const handleOffline = () => { isOnlineRef.current = false; };
    const handleOnline = () => probeConnectivity();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const reportTileOutcome = (kind) => {
    tileTallyRef.current[kind] += 1;
    if (tallyDebounceRef.current) clearTimeout(tallyDebounceRef.current);
    tallyDebounceRef.current = setTimeout(() => {
      const { online, offline, failed } = tileTallyRef.current;
      // Prefer the best outcome seen in the batch: even one tile loading
      // online means we have a connection; local tiles mean we're covered
      // offline; only report "unavailable" if nothing came through at all.
      let next = 'checking';
      if (online > 0) next = 'online';
      else if (offline > 0) next = 'offline';
      else if (failed > 0) next = 'unavailable';
      setTileStatus((prev) => (prev === next ? prev : next));
      tileTallyRef.current = { online: 0, offline: 0, failed: 0 };
    }, 350);
  };

  // Following stops when the operator manually drags the map.
  const [followRover, setFollowRover] = useState(true);
  const followRoverRef = useRef(true);

  useEffect(() => {
    followRoverRef.current = followRover;
  }, [followRover]);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    onMapClickRef.current = onMapClick;

    if (mapContainerRef.current) {
      mapContainerRef.current.style.cursor =
        interactionMode === 'DRAW_BOUNDARY' ||
        interactionMode === 'SET_WAYPOINTS'
          ? 'crosshair'
          : '';
    }
  }, [interactionMode, onMapClick]);

  const FastFallbackTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
      const tile = document.createElement('img');

      // `tile.src` is always resolved to an absolute URL by the browser, so
      // comparing it against a relative path string would never match —
      // that was the original bug causing an infinite retry loop on any
      // tile missing from every source. A named `stage` can't lie that way.
      //
      // Three tiers, tried in order: the network, the tiles bundled with the
      // app at build time, and finally whatever the user has downloaded
      // themselves on this machine through the in-app Tile Manager.
      let settled = false;
      let stage = 'online'; // 'online' | 'bundled' | 'downloaded'
      let timeoutId = null;

      const bundledUrl = `/tiles/${coords.z}/${coords.x}/${coords.y}.png`;
      const onlineUrl = this.getTileUrl(coords);

      const clearPendingTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const giveUp = () => {
        if (settled) return;
        settled = true;
        reportTileOutcome('failed');
        this._tileOnError(done, tile, new Error('Tile not found online, bundled, or in downloaded tiles'));
      };

      const tryDownloaded = () => {
        const dir = userTilesDirRef.current;
        if (!dir) {
          // Nothing to wait for — this tier just isn't available (not
          // running under Tauri, or it hasn't resolved yet for this
          // session's very first tile).
          giveUp();
          return;
        }
        stage = 'downloaded';
        tile.src = convertFileSrc(`${dir}/${coords.z}/${coords.x}/${coords.y}.png`);
        timeoutId = setTimeout(() => {
          if (!settled) giveUp();
        }, 3000);
      };

      const tryBundled = () => {
        stage = 'bundled';
        tile.src = bundledUrl;
        timeoutId = setTimeout(() => {
          if (!settled) tryDownloaded();
        }, 3000);
      };

      // Separate, lightweight listener purely for the status banner — kept
      // apart from Leaflet's own required _tileOnLoad binding below so a
      // mistake here can never break actual tile rendering.
      L.DomEvent.on(tile, 'load', () => {
        if (settled) return;
        settled = true;
        clearPendingTimeout();
        reportTileOutcome(stage === 'online' ? 'online' : 'offline');
      });

      L.DomEvent.on(
        tile,
        'load',
        L.Util.bind(this._tileOnLoad, this, done, tile)
      );

      L.DomEvent.on(tile, 'error', () => {
        clearPendingTimeout();
        if (stage === 'online') tryBundled();
        else if (stage === 'bundled') tryDownloaded();
        else giveUp();
      });

      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        tile.crossOrigin =
          this.options.crossOrigin === true
            ? ''
            : this.options.crossOrigin;
      }

      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      if (!isOnlineRef.current) {
        // The background probe already knows we're offline — skip the
        // network attempt entirely and go straight to the bundled tile.
        tryBundled();
      } else {
        tile.src = onlineUrl;
        // isOnlineRef is only as fresh as the last probe (every ~7s), so
        // this is just a short backstop for the gap between probes — not
        // the primary offline detection anymore.
        timeoutId = setTimeout(() => {
          if (!settled && stage === 'online') tryBundled();
        }, 2500);
      }

      return tile;
    }
  });

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapInstanceRef.current = L.map(mapContainerRef.current, {
      zoomControl: true,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: REGION_BOUNDS,
      maxBoundsViscosity: 1.0,
      preferCanvas: true,
      zoomAnimation: true,
      fadeAnimation: false,
      updateWhenZooming: false,
      updateWhenIdle: true
    }).setView(center, zoom);

    new FastFallbackTileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 20,
        subdomains: ['a', 'b', 'c']
      }
    ).addTo(mapInstanceRef.current);

    boundaryPolygonRef.current = L.polygon([], {
      color: '#1F5132',
      weight: 3,
      fillColor: '#1F5132',
      fillOpacity: 0.12,
      dashArray: '5, 8'
    }).addTo(mapInstanceRef.current);

    boundaryPointsGroupRef.current = L.layerGroup().addTo(
      mapInstanceRef.current
    );

    historicalLabelsGroupRef.current = L.layerGroup().addTo(
      mapInstanceRef.current
    );

    waypointLayerGroupRef.current = L.layerGroup().addTo(
      mapInstanceRef.current
    );

    routePolylineRef.current = L.polyline([], {
      color: '#D99A2B',
      dashArray: '6, 8',
      weight: 3
    }).addTo(mapInstanceRef.current);

    const roverIcon = L.divIcon({
      className: 'rover-marker',
      html: `<div style="
        background: #1F5132;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 3px solid #fff;
        box-shadow: 0 0 10px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [18, 18]
    });

    // Create the marker safely, but display it only when allowed
    // and when an actual position is available.
    const initialRoverPos = hasMapPosition(roverPos)
      ? roverPos
      : center;

    roverMarkerRef.current = L.marker(initialRoverPos, {
      icon: roverIcon
    });

    if (showRover && hasMapPosition(roverPos)) {
      roverMarkerRef.current.addTo(mapInstanceRef.current);
    }

    mapInstanceRef.current.on('click', (e) => {
      if (
        interactionModeRef.current !== 'NONE' &&
        onMapClickRef.current
      ) {
        onMapClickRef.current([e.latlng.lat, e.latlng.lng]);
      }
    });

    mapInstanceRef.current.on('dragstart', () => {
      followRoverRef.current = false;
      setFollowRover(false);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update the field boundary.
  useEffect(() => {
    if (
      !boundaryPolygonRef.current ||
      !boundaryPointsGroupRef.current
    ) {
      return;
    }

    boundaryPointsGroupRef.current.clearLayers();

    if (boundary && boundary.length > 0) {
      boundaryPolygonRef.current.setLatLngs(boundary);

      boundary.forEach((coord) => {
        const dotIcon = L.divIcon({
          className: 'boundary-dot',
          html: `<div style="
            width: 10px;
            height: 10px;
            background: #1F5132;
            border: 2px solid #fff;
            border-radius: 50%;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4);
          "></div>`,
          iconSize: [10, 10]
        });

        L.marker(coord, { icon: dotIcon }).addTo(
          boundaryPointsGroupRef.current
        );
      });
    } else {
      boundaryPolygonRef.current.setLatLngs([]);
    }
  }, [boundary]);

  // Render the heatmap.
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (heatLayerRef.current) {
      mapInstanceRef.current.removeLayer(heatLayerRef.current);
    }

    if (heatPoints.length > 0) {
      const interpolatedPoints = generateIDWHeatmapGrid(
        heatPoints,
        boundary,
        {
          gridResolution: 32,
          power: 2.0,
          maxInfluenceRadiusM: 55
        }
      );

      if (interpolatedPoints.length > 0) {
        heatLayerRef.current = L.heatLayer(interpolatedPoints, {
          radius: 22,
          blur: 16,
          maxZoom: 19,
          gradient: gradient
        }).addTo(mapInstanceRef.current);
      }
    }
  }, [heatPoints, boundary, gradient]);

  // Frame the selected historical samples.
  useEffect(() => {
    if (!mapInstanceRef.current || focusPoints.length === 0) return;

    if (focusPoints.length === 1) {
      mapInstanceRef.current.setView(focusPoints[0], 18, {
        animate: true
      });
      return;
    }

    mapInstanceRef.current.fitBounds(
      L.latLngBounds(focusPoints),
      {
        padding: [32, 32],
        maxZoom: 18,
        animate: true
      }
    );
  }, [focusPoints]);

  // Render numbered historical markers.
  useEffect(() => {
    if (!historicalLabelsGroupRef.current) return;

    historicalLabelsGroupRef.current.clearLayers();

    labeledPoints.forEach(({ lat, lng, label, isAnchor }) => {
      if (
        !Number.isFinite(Number(lat)) ||
        !Number.isFinite(Number(lng))
      ) {
        return;
      }

      const markerIcon = L.divIcon({
        className: 'historical-map-label',
        html: `<div style="
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${isAnchor ? '#D99A2B' : '#1F5132'};
          color: #fff;
          border: 2px solid #fff;
          box-shadow: 0 2px 7px rgba(0, 0, 0, 0.35);
          font-size: 12px;
          font-weight: 800;
        ">${label}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      L.marker([lat, lng], {
        icon: markerIcon,
        zIndexOffset: 700,
        title: isAnchor
          ? `Anchor sample #${label}`
          : `Historical sample #${label}`
      }).addTo(historicalLabelsGroupRef.current);
    });
  }, [labeledPoints]);

  // Update the rover marker while respecting Julius's showRover option.
  useEffect(() => {
    if (!roverMarkerRef.current || !mapInstanceRef.current) return;

    if (showRover && hasMapPosition(roverPos)) {
      roverMarkerRef.current.setLatLng(roverPos);

      if (!mapInstanceRef.current.hasLayer(roverMarkerRef.current)) {
        roverMarkerRef.current.addTo(mapInstanceRef.current);
      }

      if (followRoverRef.current) {
        mapInstanceRef.current.panTo(roverPos, {
          animate: true,
          duration: 0.5
        });
      }
    } else {
      mapInstanceRef.current.removeLayer(roverMarkerRef.current);
    }
  }, [roverPos, showRover]);

  // Render mission waypoints and preserve individual pin deletion.
  useEffect(() => {
    if (
      !waypointLayerGroupRef.current ||
      !routePolylineRef.current
    ) {
      return;
    }

    waypointLayerGroupRef.current.clearLayers();

    waypoints.forEach((pt, index) => {
      const pinIcon = waypointsDeletable
        ? L.divIcon({
            className: 'custom-pin deletable-pin',
            html: `<div style="
              background: #dc2626;
              color: white;
              width: 24px;
              height: 24px;
              border-radius: 50%;
              border: 2px solid white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 15px;
              font-weight: bold;
              line-height: 1;
              box-shadow: 0 2px 6px rgba(0,0,0,0.4);
              cursor: pointer;
            ">&times;</div>`,
            iconSize: [24, 24]
          })
        : L.divIcon({
            className: 'custom-pin',
            html: `<div style="
              background: #8A5A35;
              color: white;
              width: 22px;
              height: 22px;
              border-radius: 50%;
              border: 2px solid white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 11px;
              font-weight: bold;
              box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            ">${index + 1}</div>`,
            iconSize: [22, 22]
          });

      const marker = L.marker(pt, {
        icon: pinIcon,
        title: waypointsDeletable
          ? `Remove pin ${index + 1}`
          : `Pin ${index + 1}`,
        zIndexOffset: waypointsDeletable ? 800 : 0
      });

      if (waypointsDeletable) {
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);

          if (onWaypointDeleteRef.current) {
            onWaypointDeleteRef.current(index);
          }
        });
      }

      marker.addTo(waypointLayerGroupRef.current);
    });

    routePolylineRef.current.setLatLngs(waypoints);
  }, [waypoints, waypointsDeletable]);

  // Place search ("jump to a landmark"). Submit-only on purpose — see
  // services/placeSearch.js for the geocoder usage policy this respects.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchNote, setSearchNote] = useState(null);
  const searchAbortRef = useRef(null);
  const searchMarkerRef = useRef(null);

  useEffect(() => () => {
    if (searchAbortRef.current) searchAbortRef.current.abort();
  }, []);

  const clearSearchMarker = () => {
    if (searchMarkerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(searchMarkerRef.current);
    }
    searchMarkerRef.current = null;
  };

  const runSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    setSearchResults([]);

    if (q.length < MIN_QUERY_LENGTH) {
      setSearchNote(`Type at least ${MIN_QUERY_LENGTH} characters.`);
      return;
    }
    if (!isOnlineRef.current) {
      setSearchNote('Place search needs an internet connection. The downloaded-map list still works offline.');
      return;
    }

    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchBusy(true);
    setSearchNote(null);

    try {
      let viewbox = null;
      if (mapInstanceRef.current) {
        const b = mapInstanceRef.current.getBounds();
        viewbox = `${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
      }
      const found = await searchPlaces(q, { viewbox, signal: controller.signal });
      if (controller.signal.aborted) return;

      const inRegion = found.filter((r) => isInRegion(r.lat, r.lng));
      if (found.length === 0) {
        setSearchNote('No places found. Try a barangay, town or landmark name.');
      } else if (inRegion.length === 0) {
        setSearchNote('Found places, but outside the supported map region (Nueva Ecija to Batangas).');
      } else {
        setSearchResults(inRegion.slice(0, 6));
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setSearchNote('Search failed. Check your connection and try again.');
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearchBusy(false);
      }
    }
  };

  const handlePickResult = (result) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Stop auto-following the rover, or the next GPS update would pan the
    // map straight back off the place just searched for.
    followRoverRef.current = false;
    setFollowRover(false);

    if (result.bounds) {
      map.fitBounds(result.bounds, { padding: [24, 24], maxZoom: 17, animate: true });
    } else {
      map.setView([result.lat, result.lng], 16, { animate: true });
    }

    clearSearchMarker();
    searchMarkerRef.current = L.marker([result.lat, result.lng], {
      icon: L.divIcon({
        className: 'search-result-marker',
        html: `<div style="
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 3px solid #D99A2B;
          background: rgba(217, 154, 43, 0.25);
          box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.35);
        "></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }),
      interactive: false,
      zIndexOffset: 900
    }).addTo(map);

    setSearchResults([]);
    setSearchQuery(result.name);
    setSearchNote(null);
  };

  const handleClearSearch = () => {
    if (searchAbortRef.current) searchAbortRef.current.abort();
    searchAbortRef.current = null;
    clearSearchMarker();
    setSearchQuery('');
    setSearchResults([]);
    setSearchNote(null);
    setSearchBusy(false);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%'
      }}
    >
      <div
        ref={mapContainerRef}
        style={{
          width: '100%',
          height: '100%'
        }}
      />

      {/* Tile source feedback: lets the operator see at a glance whether the
          basemap is live, running off saved offline tiles, or missing both. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          // Leaflet's own zoom control sits at top:10px/left:10px and is
          // ~54px tall (two stacked buttons) — this badge used to start at
          // top:12px, landing right on top of the "+" button. Clearing that
          // height is the actual fix; left stays the same corner.
          top: '18px',
          left: '330px',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          borderRadius: '8px',
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          background:
            tileStatus === 'online'
              ? 'rgba(22, 101, 52, 0.9)'
              : tileStatus === 'offline'
              ? 'rgba(202, 138, 4, 0.92)'
              : tileStatus === 'unavailable'
              ? 'rgba(185, 28, 28, 0.92)'
              : 'rgba(71, 85, 105, 0.85)'
        }}
      >
        {tileStatus === 'online' && (
          <>
            <Wifi size={13} /> Online map
          </>
        )}
        {tileStatus === 'offline' && (
          <>
            <WifiOff size={13} /> Offline — saved tiles
          </>
        )}
        {tileStatus === 'unavailable' && (
          <>
            <CloudOff size={13} /> Map tiles unavailable
          </>
        )}
        {tileStatus === 'checking' && (
          <>
            <Wifi size={13} /> Loading map…
          </>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '56px',
          zIndex: 1000,
          width: '270px',
          maxWidth: 'calc(100% - 320px)'
        }}
      >
        <form
          onSubmit={runSearch}
          role="search"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 8px',
            borderRadius: '8px',
            border: '1px solid var(--card-border, #e2e8f0)',
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
        >
          <Search size={14} color="var(--text-muted, #64748b)" style={{ flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (searchNote) setSearchNote(null);
            }}
            placeholder="Search a place or landmark"
            aria-label="Search a place or landmark"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '0.78rem',
              color: 'var(--text-dark, #1e293b)'
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label="Clear search"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <X size={14} color="var(--text-muted, #64748b)" />
            </button>
          )}
          <button
            type="submit"
            disabled={searchBusy}
            style={{
              border: 'none',
              borderRadius: '6px',
              background: 'var(--primary-green, #1F5132)',
              color: '#fff',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '4px 9px',
              cursor: searchBusy ? 'default' : 'pointer',
              opacity: searchBusy ? 0.7 : 1
            }}
          >
            {searchBusy ? '…' : 'Go'}
          </button>
        </form>

        {searchNote && (
          <div
            role="status"
            style={{
              marginTop: '6px',
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid var(--card-border, #e2e8f0)',
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              fontSize: '0.72rem',
              color: 'var(--text-muted, #64748b)'
            }}
          >
            {searchNote}
          </div>
        )}

        {searchResults.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: '6px 0 0',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid var(--card-border, #e2e8f0)',
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              maxHeight: '240px',
              overflowY: 'auto'
            }}
          >
            {searchResults.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => handlePickResult(r)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    border: 'none',
                    borderRadius: '6px',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--text-dark, #1e293b)'
                  }}
                >
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}{r.kind ? <span style={{ fontWeight: 400, color: 'var(--text-muted, #64748b)' }}> · {r.kind}</span> : null}
                  </div>
                  {r.label && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #64748b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.label}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Jump to a downloaded map: lists bundled + user-downloaded coverage
          (same list the Tile Manager shows) so the operator doesn't have to
          already know where an offline area is before finding it. Placed
          top-right, clear of the zoom control (top-left) and the status
          badge below it. */}
      {coverageAreas.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            maxWidth: '230px',
            padding: '5px 8px',
            borderRadius: '8px',
            border: '1px solid var(--card-border, #e2e8f0)',
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
        >
          <MapPin size={13} color="var(--primary-green, #1F5132)" style={{ flexShrink: 0 }} />
          <select
            onChange={handleJumpToCoverageArea}
            defaultValue=""
            title="Jump to a downloaded map area"
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-dark, #1e293b)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              maxWidth: '190px'
            }}
          >
            <option value="" disabled>
              Jump to downloaded map…
            </option>
            {coverageAreas.map((area, i) => (
              <option key={`${area.name}-${i}`} value={i}>
                {area.name} · {area.source === 'bundled' ? 'shipped' : 'downloaded'}
              </option>
            ))}
          </select>
        </div>
      )}

      {gpsWarning && (
        <div
          className="gps-map-overlay"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>GPS not locked</strong>
            <span>{gpsWarning}</span>
          </div>
        </div>
      )}

      {showFollowControl && hasMapPosition(roverPos) && (
        <button
          onClick={() => {
            setFollowRover(true);
            followRoverRef.current = true;

            if (mapInstanceRef.current && hasMapPosition(roverPos)) {
              mapInstanceRef.current.panTo(roverPos, {
                animate: true,
                duration: 0.5
              });
            }
          }}
          title={
            followRover
              ? 'Following rover'
              : 'Click to re-center on rover'
          }
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid var(--card-border, #e2e8f0)',
            background: followRover
              ? 'var(--primary-green, #1F5132)'
              : '#fff',
            color: followRover
              ? '#fff'
              : 'var(--text-dark, #1e293b)',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
        >
          <Crosshair size={14} />
          {followRover ? 'Following' : 'Follow Rover'}
        </button>
      )}
    </div>
  );
}