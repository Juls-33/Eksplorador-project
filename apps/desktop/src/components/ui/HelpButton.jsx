import React from 'react';
import { CircleHelp } from 'lucide-react';
import { getHelpRoute, MANUAL_GUIDES } from '../../config/helpRoutes.js';

export default function HelpButton({ viewId, onOpen }) {
  const route = getHelpRoute(viewId);
  if (!route || !onOpen) return null;
  const label = `Open ${MANUAL_GUIDES.find(guide => guide.id === route.guideId).label}`;
  return <button type="button" className="help-button ui-control" onClick={onOpen} title={label} aria-label={label}>
    <CircleHelp size={16} aria-hidden="true" /><span>Help</span>
  </button>;
}
