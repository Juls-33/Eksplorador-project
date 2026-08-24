import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';

export default function HeatmapMap({
  center = [14.5995, 120.9842],
  zoom = 18,
  heatPoints = [],
  roverPos = [14.5995, 120.9842]
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const heatLayerRef = useRef(null);
  const roverMarkerRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Base Leaflet Map
    mapInstanceRef.current = L.map(mapContainerRef.current, {
      zoomControl: true
    }).setView(center, zoom);

    // OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 20
    }).addTo(mapInstanceRef.current);

    // Custom Rover Indicator Icon
    const roverIcon = L.divIcon({
      className: 'rover-marker',
      html: `<div style="
        background: #1F5132;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 3px solid #fff;
        box-shadow: 0 0 10px rgba(0,0,0,0.4);
      "></div>`,
      iconSize: [16, 16]
    });

    roverMarkerRef.current = L.marker(roverPos, { icon: roverIcon }).addTo(mapInstanceRef.current);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }
    };
  }, []);

  // Update Heatmap points
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

  return <div ref={mapContainerRef} className="map-container" />;
}