export const APP_TIMEZONE = 'Asia/Manila';

const OFFSET_MS = 8 * 60 * 60 * 1000;

// Calendar defaults and export labels use UTC+8 on every operator's PC.
// Existing measurement timestamps are passed through unchanged.
export function appTimestamp(date = new Date()) {
  return new Date(date.getTime() + OFFSET_MS)
    .toISOString()
    .replace('Z', '+08:00');
}

export function appDate(date = new Date()) {
  return appTimestamp(date).slice(0, 10);
}