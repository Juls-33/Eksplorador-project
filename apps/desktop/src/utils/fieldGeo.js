// GeoJSON (de)serialization for field boundaries and mission pins.
// In the app, points are [lat, lng]; GeoJSON stores [lng, lat], so every
// conversion swaps the order. Both readers return [] for missing/bad data.

export function boundaryToGeoJSON(latlngs) {
  if (!Array.isArray(latlngs) || latlngs.length < 3) return null;
  const ring = latlngs.map(([lat, lng]) => [lng, lat]);
  ring.push([...ring[0]]);
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
}

export function geoJSONToBoundary(text) {
  try {
    const geo = typeof text === 'string' ? JSON.parse(text) : text;
    if (!geo || geo.type !== 'Polygon' || !Array.isArray(geo.coordinates?.[0])) return [];
    const ring = geo.coordinates[0].map(([lng, lat]) => [lat, lng]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    return ring;
  } catch {
    return [];
  }
}

export function pinsToGeoJSON(pins) {
  if (!Array.isArray(pins) || pins.length === 0) return null;
  return JSON.stringify({
    type: 'FeatureCollection',
    features: pins.map(([lat, lng], index) => ({
      type: 'Feature',
      properties: { order: index + 1 },
      geometry: { type: 'Point', coordinates: [lng, lat] }
    }))
  });
}

export function geoJSONToPins(text) {
  try {
    const geo = typeof text === 'string' ? JSON.parse(text) : text;
    if (!geo) return [];
    if (geo.type === 'MultiPoint') return geo.coordinates.map(([lng, lat]) => [lat, lng]);
    if (geo.type !== 'FeatureCollection') return [];
    return geo.features
      .filter((f) => f.geometry?.type === 'Point')
      .sort((a, b) => (a.properties?.order ?? 0) - (b.properties?.order ?? 0))
      .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
  } catch {
    return [];
  }
}

export function hasBoundary(field) {
  return Array.isArray(field?.boundary) && field.boundary.length >= 3;
}