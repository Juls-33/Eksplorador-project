// IDs match the existing User Manual guides. Dashboard is the Live Monitoring tab.
export const MANUAL_GUIDES = [
  { id: 'rover', label: 'Rover Operation Guide' },
  { id: 'field', label: 'Field Map Guide' },
  { id: 'monitoring', label: 'Live Monitoring Guide' },
  { id: 'crops', label: 'Crop Assessment Guide' },
  { id: 'reports', label: 'Reports Guide' },
  { id: 'offline', label: 'Offline Map Guide' },
];

export const HELP_ROUTES = {
  Dashboard: { guideId: 'monitoring', pageLabel: 'Live Monitoring' },
  'Field Map': { guideId: 'field', pageLabel: 'Field Map' },
  'Crop Assessment': { guideId: 'crops', pageLabel: 'Crop Assessment' },
  Reports: { guideId: 'reports', pageLabel: 'Reports' },
  'Offline Maps': { guideId: 'offline', pageLabel: 'Offline Maps' },
};

export function resolveGuideId(guideId) {
  return MANUAL_GUIDES.some(guide => guide.id === guideId) ? guideId : 'rover';
}

export function getHelpRoute(tabId) {
  return Object.hasOwn(HELP_ROUTES, tabId) ? HELP_ROUTES[tabId] : null;
}
