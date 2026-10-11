// Place search for the map's "jump to a landmark" box.
//
// Uses OpenStreetMap's public Nominatim geocoder. Its usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) shapes this
// module on purpose:
//   - at most 1 request per second for the whole application  -> MIN_INTERVAL_MS
//   - no search-as-you-type (callers must only search on an explicit submit)
//   - results should be cached                                 -> `cache` below
//   - requests must identify the application                   -> CONTACT_EMAIL
//
// That is fine for team use. Like the tile downloader, this should point at a
// geocoding provider you hold a key for before a public release: replace the
// body of searchPlaces(); the normalized result shape is all the UI depends on.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// A browser/webview fetch cannot set a User-Agent header, so Nominatim's
// `email` parameter is the way to identify this app. Put a real contact here.
// Left empty, no identifying parameter is sent.
const CONTACT_EMAIL = '';

const MIN_INTERVAL_MS = 1100;
export const MIN_QUERY_LENGTH = 3;

const cache = new Map();
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError() {
  return new DOMException('Search aborted', 'AbortError');
}

function normalize(row) {
  const lat = parseFloat(row.lat);
  const lng = parseFloat(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Nominatim orders boundingbox as [south, north, west, east].
  let bounds = null;
  if (Array.isArray(row.boundingbox) && row.boundingbox.length === 4) {
    const [south, north, west, east] = row.boundingbox.map(parseFloat);
    if ([south, north, west, east].every(Number.isFinite)) {
      bounds = [[south, west], [north, east]];
    }
  }

  const parts = String(row.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    id: String(row.place_id ?? `${lat},${lng}`),
    name: row.name || parts[0] || 'Unnamed place',
    label: parts.slice(1, 4).join(', '),
    kind: row.type ? String(row.type).replace(/_/g, ' ') : '',
    lat,
    lng,
    bounds
  };
}

// viewbox is "west,north,east,south" (the current map view). It only biases
// ranking toward what's on screen, so nearby matches come first.
export async function searchPlaces(query, { viewbox = null, signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  if (signal?.aborted) throw abortError();
  lastRequestAt = Date.now();

  const params = new URLSearchParams({
    format: 'jsonv2',
    q,
    countrycodes: 'ph',
    limit: '8',
    'accept-language': 'en'
  });
  if (viewbox) params.set('viewbox', viewbox);
  if (CONTACT_EMAIL) params.set('email', CONTACT_EMAIL);

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Search service returned HTTP ${res.status}`);

  const rows = await res.json();
  const results = (Array.isArray(rows) ? rows : []).map(normalize).filter(Boolean);
  cache.set(key, results);
  return results;
}