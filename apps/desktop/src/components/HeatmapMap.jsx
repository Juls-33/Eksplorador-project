import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';

export default function HeatmapMap({
  center = [14.5995, 120.9842],
  zoom = 18,
  heatPoints = [],
  roverPos = [14.5995, 120.9842],
  waypoints = [],
  onMapClick = null,
  isSettingWaypoints = false
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const heatLayerRef = useRef(null);
  const roverMarkerRef = useRef(null);
  const waypointLayerGroupRef = useRef(null);
  const routePolylineRef = useRef(null);

  // Keep references to latest state to avoid stale closure issues in Leaflet event listeners
  const isSettingWaypointsRef = useRef(isSettingWaypoints);
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    isSettingWaypointsRef.current = isSettingWaypoints;
    onMapClickRef.current = onMapClick;

    // Toggle crosshair cursor dynamically on container
    if (mapContainerRef.current) {
      mapContainerRef.current.style.cursor = isSettingWaypoints ? 'crosshair' : '';
    }
  }, [isSettingWaypoints, onMapClick]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialize Map
    mapInstanceRef.current = L.map(mapContainerRef.current, {
      zoomControl: true
    }).setView(center, zoom);

    // OpenStreetMap Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 20
    }).addTo(mapInstanceRef.current);

    waypointLayerGroupRef.current = L.layerGroup().addTo(mapInstanceRef.current);
    routePolylineRef.current = L.polyline([], {
      color: '#D99A2B',
      dashArray: '6, 8',
      weight: 3
    }).addTo(mapInstanceRef.current);

    // Rover Marker
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

    roverMarkerRef.current = L.marker(roverPos, { icon: roverIcon }).addTo(mapInstanceRef.current);

    // Map Click Handler: ONLY triggers when in waypoint setting mode
    mapInstanceRef.current.on('click', (e) => {
      if (isSettingWaypointsRef.current && onMapClickRef.current) {
        onMapClickRef.current([e.latlng.lat, e.latlng.lng]);
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }
    };
  }, []);

  // Update Heatmap Points
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (heatLayerRef.current) {
      mapInstanceRef.current.removeLayer(heatLayerRef.current);
    }

    if (heatPoints.length > 0) {
      heatLayerRef.current = L.heatLayer(heatPoints, {
        radius: 30,
        blur: 18,
        maxZoom: 19,
        gradient: {
          0.2: '#1F5132',
          0.5: '#8A5A35',
          0.8: '#D99A2B',
          1.0: '#b91c1c'
        }
      }).addTo(mapInstanceRef.current);
    }
  }, [heatPoints]);

  // Update Rover Marker Position
  useEffect(() => {
    if (roverMarkerRef.current && roverPos) {
      roverMarkerRef.current.setLatLng(roverPos);
    }
  }, [roverPos]);

  // Draw Waypoints & Path
  useEffect(() => {
    if (!waypointLayerGroupRef.current || !routePolylineRef.current) return;

    waypointLayerGroupRef.current.clearLayers();

    waypoints.forEach((pt, index) => {
      const pinIcon = L.divIcon({
        className: 'custom-pin',
        html: `<div style="
          background: #8A5A35;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        ">${index + 1}</div>`,
        iconSize: [24, 24]
      });

      L.marker(pt, { icon: pinIcon }).addTo(waypointLayerGroupRef.current);
    });

    routePolylineRef.current.setLatLngs(waypoints);
  }, [waypoints]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />;
}