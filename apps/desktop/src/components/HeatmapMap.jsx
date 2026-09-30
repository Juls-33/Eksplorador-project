import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { AlertTriangle, Crosshair } from 'lucide-react';
import { generateIDWHeatmapGrid } from '../utils/geo';

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

      L.DomEvent.on(
        tile,
        'load',
        L.Util.bind(this._tileOnLoad, this, done, tile)
      );

      const localUrl = `/tiles/${coords.z}/${coords.x}/${coords.y}.png`;
      const onlineUrl = this.getTileUrl(coords);

      L.DomEvent.on(tile, 'error', () => {
        if (tile.src !== localUrl) {
          tile.src = localUrl;
        } else {
          this._tileOnError(
            done,
            tile,
            new Error('Tile not found locally or online')
          );
        }
      });

      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        tile.crossOrigin =
          this.options.crossOrigin === true
            ? ''
            : this.options.crossOrigin;
      }

      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      if (!navigator.onLine) {
        tile.src = localUrl;
      } else {
        tile.src = onlineUrl;
      }

      return tile;
    }
  });

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const REGION_BOUNDS = [
      [14.05, 120.70],
      [16.05, 121.60]
    ];

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