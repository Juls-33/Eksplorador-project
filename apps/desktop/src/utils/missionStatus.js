export function describeMissionStatus(deployment) {
  const status = deployment?.mega_status;
  if (!status) return deployment?.acknowledged
    ? 'Rover acknowledged delivery to the UART queue. Waiting for Mega mission staging or rejection.'
    : 'Waiting for a matching Mega mission report. Delivery and staging are unconfirmed.';
  const states = {
    STAGED: 'Mission accepted for staging. Autonomous navigation remains disabled pending calibration.',
    REJECTED: 'Mega rejected this mission. Operator review required.',
    HELD: 'Mega reports the mission held. Autonomous navigation remains disabled pending calibration.',
    NAVIGATING: 'Mega reports navigation in progress.',
    PAUSED: 'Mega reports the mission paused.',
    HOLD_LOCALIZATION: 'Mega reports a localization hold. Valid localization and operator authorization are required.',
    HOLD_SAFETY: 'Mega reports a safety hold. Operator recovery is required.',
    FAULT: 'Mega reports a mission fault. Keep HOLD and DISARM selected.',
    ABORTED: 'Mega reports the mission aborted.',
    COMPLETE: 'Mega reports mission completion.',
    COMPLETED: 'Mega reports mission completion.',
  };
  return `${states[status.state] || `Mega reports ${status.state}.`} Reason: ${status.reason}; step: ${status.step}.`;
}
