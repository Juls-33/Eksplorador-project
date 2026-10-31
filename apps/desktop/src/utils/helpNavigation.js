import { getHelpRoute } from '../config/helpRoutes.js';

export const initialNavigation = { activeTab: 'Dashboard', help: null };

// Contextual Help temporarily covers its source; ordinary tab changes retain
// the app's existing unmount behavior. No mission or telemetry state lives here.
export function helpNavigationReducer(state, action) {
  switch (action.type) {
    case 'tab':
      return getHelpRoute(action.tabId) || action.tabId === 'User Manual'
        ? { activeTab: action.tabId, help: null }
        : state;
    case 'help': {
      const route = getHelpRoute(state.activeTab);
      return route
        ? { activeTab: 'User Manual', help: { ...route, fromTab: state.activeTab } }
        : state;
    }
    case 'back':
      return state.activeTab === 'User Manual' && state.help
        ? { activeTab: state.help.fromTab, help: null }
        : state;
    default:
      return state;
  }
}

export function getSourceTab({ activeTab, help }) {
  return activeTab === 'User Manual' ? help?.fromTab ?? null : activeTab;
}
