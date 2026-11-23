// Presentation-level boundary for choosing Point A. The authoritative plan is
// still validated by makeStraightLeg immediately before transmission.
import { calculateDistance } from './geo.js';
import { FORWARD_MPS, MAX_LEG_S, validPoint } from './pointToPointMission.js';

export const MAX_PLANNING_RADIUS_M = FORWARD_MPS * MAX_LEG_S;

export function planningDistanceM(origin, destination) {
  if (!validPoint(origin) || !validPoint(destination)) return null;
  const distance = calculateDistance(origin, destination);
  return Number.isFinite(distance) ? distance : null;
}

// Match makeStraightLeg's time-bound comparison, including its floating-point tolerance.
export function isWithinPlanningRadius(origin, destination) {
  const distance = planningDistanceM(origin, destination);
  return distance !== null && distance / FORWARD_MPS <= MAX_LEG_S + 1e-9;
}
