import { calculateDistanceMeters } from './geo';

// A sample recorded within this many meters of a pin counts as having reached it.
export const PIN_REACH_RADIUS_M = 5;

// Works out which pins of a mission have been reached, from its recorded samples.
//
// - Any pin can be reached, in any order: a sample near pin 2 marks pin 2 even
//   while pin 1 is still pending.
// - Each sample marks at most ONE pin — the nearest not-yet-reached pin within
//   the radius — so a single probe insertion can't use up two pins that happen
//   to sit close together.
// - Samples that are not near any pin are simply ignored here; they are still
//   recorded as usual, this only decides the navigation progress.
//
// Samples are read in recorded order. Returns the set of reached pin indexes
// and `last` = { pin (1-based), distanceM } for the sample that most recently
// marked a pin, or null.
export function computeReachedPins(samples, pins, radiusM = PIN_REACH_RADIUS_M) {
  const reached = new Set();
  let last = null;

  if (!Array.isArray(samples) || !Array.isArray(pins) || pins.length === 0) {
    return { reached, last };
  }

  for (const sample of samples) {
    const lat = Number(sample.lat ?? sample.coords?.[0]);
    const lng = Number(sample.lng ?? sample.coords?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let bestIdx = -1;
    let bestDistance = Infinity;
    pins.forEach((pin, idx) => {
      if (reached.has(idx)) return;
      const distance = calculateDistanceMeters([lat, lng], pin);
      if (distance <= radiusM && distance < bestDistance) {
        bestDistance = distance;
        bestIdx = idx;
      }
    });

    if (bestIdx !== -1) {
      reached.add(bestIdx);
      last = { pin: bestIdx + 1, distanceM: bestDistance };
    }
  }

  return { reached, last };
}

// The pin to head for next: the first one not yet reached. Equals pins.length
// when every pin is done.
export function firstPendingPin(pinCount, reachedIdxs) {
  let idx = 0;
  while (idx < pinCount && reachedIdxs.has(idx)) idx += 1;
  return idx;
}