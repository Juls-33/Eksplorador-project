import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
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

    roverMarkerRef.current = L.marker(roverPos, { icon: roverIcon }).addTo(mapInstanceRef.current);

    mapInstanceRef.current.on('click', (e) => {
      if (interactionModeRef.current !== 'NONE' && onMapClickRef.current) {
        onMapClickRef.current([e.latlng.lat, e.latlng.lng]);
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
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

  // Update Rover GPS Marker
  useEffect(() => {
    if (roverMarkerRef.current && roverPos) {
      roverMarkerRef.current.setLatLng(roverPos);
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

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />;
}