import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { Crosshair } from 'lucide-react';
import { generateIDWHeatmapGrid } from '../utils/geo';

export default function HeatmapMap({
  center = [14.6095, 120.9895],
  zoom = 18,
  heatPoints = [],
  roverPos = [14.6095, 120.9895],
  waypoints = [],
  boundary = [],
  onMapClick = null,
  interactionMode = 'NONE', // 'NONE' | 'DRAW_BOUNDARY' | 'SET_WAYPOINTS'
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

  const interactionModeRef = useRef(interactionMode);
  const onMapClickRef = useRef(onMapClick);

  // Whether the map should automatically re-center on the rover's position
  // as it updates. Turns itself off if the user manually drags the map
  // (so it doesn't fight someone trying to look elsewhere), and can be
  // re-enabled with the toggle button.
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
        interactionMode === 'DRAW_BOUNDARY' || interactionMode === 'SET_WAYPOINTS'
          ? 'crosshair'
          : '';
    }
  }, [interactionMode, onMapClick]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapInstanceRef.current = L.map(mapContainerRef.current, {
      zoomControl: true
    }).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 20
    }).addTo(mapInstanceRef.current);

    boundaryPolygonRef.current = L.polygon([], {
      color: '#1F5132',
      weight: 3,
      fillColor: '#1F5132',
      fillOpacity: 0.12,
      dashArray: '5, 8'
    }).addTo(mapInstanceRef.current);

    boundaryPointsGroupRef.current = L.layerGroup().addTo(mapInstanceRef.current);
    waypointLayerGroupRef.current = L.layerGroup().addTo(mapInstanceRef.current);
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

    // Guard against a null/invalid roverPos (e.g. no GPS fix yet) so the map
    // instance always finishes initializing and its cleanup gets registered —
    // an uncaught error here previously left a stale Leaflet instance attached
    // to the DOM node, causing "Map container is already initialized" on remount.
    const initialRoverPos = Array.isArray(roverPos) && roverPos.length === 2 ? roverPos : center;
    roverMarkerRef.current = L.marker(initialRoverPos, { icon: roverIcon }).addTo(mapInstanceRef.current);

    mapInstanceRef.current.on('click', (e) => {
      if (interactionModeRef.current !== 'NONE' && onMapClickRef.current) {
        onMapClickRef.current([e.latlng.lat, e.latlng.lng]);
      }
    });

    // Dragstart only fires on real user mouse/touch interaction, not on
    // programmatic panTo/setView calls — so this cleanly detects "the user
    // wants to look somewhere else" without also triggering on our own
    // auto-follow pans.
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

  // Update Field Boundary Polygon
  useEffect(() => {
    if (!boundaryPolygonRef.current || !boundaryPointsGroupRef.current) return;

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
        L.marker(coord, { icon: dotIcon }).addTo(boundaryPointsGroupRef.current);
      });
    } else {
      boundaryPolygonRef.current.setLatLngs([]);
    }
  }, [boundary]);

  // Compute & Render Dense IDW Heatmap with Selected Gradient
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (heatLayerRef.current) {
      mapInstanceRef.current.removeLayer(heatLayerRef.current);
    }

    if (heatPoints.length > 0) {
      const interpolatedPoints = generateIDWHeatmapGrid(heatPoints, boundary, {
        gridResolution: 32,
        power: 2.0,
        maxInfluenceRadiusM: 55
      });

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

  // Update Rover GPS Marker (and re-center the map if auto-follow is on)
  useEffect(() => {
    // Guard here too — this effect runs on every roverPos change, so a null
    // (no GPS fix) must not crash setLatLng.
    if (roverMarkerRef.current && Array.isArray(roverPos) && roverPos.length === 2) {
      roverMarkerRef.current.setLatLng(roverPos);

      if (followRoverRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.panTo(roverPos, { animate: true, duration: 0.5 });
      }
    }
  }, [roverPos]);

  // Draw Mission Waypoints & Polyline
  useEffect(() => {
    if (!waypointLayerGroupRef.current || !routePolylineRef.current) return;

    waypointLayerGroupRef.current.clearLayers();

    waypoints.forEach((pt, index) => {
      const pinIcon = L.divIcon({
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

      L.marker(pt, { icon: pinIcon }).addTo(waypointLayerGroupRef.current);
    });

    routePolylineRef.current.setLatLngs(waypoints);
  }, [waypoints]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      <button
        onClick={() => {
          setFollowRover(true);
          followRoverRef.current = true;
          if (mapInstanceRef.current && Array.isArray(roverPos) && roverPos.length === 2) {
            mapInstanceRef.current.panTo(roverPos, { animate: true, duration: 0.5 });
          }
        }}
        title={followRover ? 'Following rover' : 'Click to re-center on rover'}
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
          background: followRover ? 'var(--primary-green, #1F5132)' : '#fff',
          color: followRover ? '#fff' : 'var(--text-dark, #1e293b)',
          fontSize: '0.75rem',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}
      >
        <Crosshair size={14} />
        {followRover ? 'Following' : 'Follow Rover'}
      </button>
    </div>
  );
}