import React from 'react';
import { describeMissionStatus } from '../utils/missionStatus';

export default function MissionStatusReport({ deployment, connected }) {
  if (!deployment) return null;
  const status = deployment.mega_status;
  return <div role="status" aria-live="polite" className="mission-status-report" style={{padding:12, background:'#f4f7f5', borderRadius:8}}>
    <strong>Last Mega mission report</strong>
    <p>{describeMissionStatus(deployment)}</p>
    {status && <p><code>{status.missionId}</code> · revision {status.statusSeq}
      {(!connected || !deployment.status_connection_confirmed) && ' · Historical report; awaiting confirmation after reconnection.'}</p>}
    <p>Physical autonomous navigation is disabled for A2.9 calibration. Keep SB (CH6) in HOLD and SA (CH5) DISARM during staging.</p>
  </div>;
}
