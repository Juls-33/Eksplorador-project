export function getConnectionStatus(connection) {
  if (connection.connectionError) {
    return {
      state: 'connection-failed', title: 'Unable to read desktop LoRa connection status',
      detail: connection.connectionError,
    };
  }
  if (connection.connected) {
    return {
      state: 'connected', title: 'Desktop LoRa connected',
      detail: [connection.port, `Mode: ${connection.mode || 'Unknown'}`].filter(Boolean).join(' · '),
    };
  }
  if (connection.hadConnection) {
    return {
      state: 'disconnected', title: 'Desktop LoRa disconnected',
      detail: 'Receiver unavailable — Check USB/COM port. Searching for receiver…',
    };
  }
  return {
    state: 'searching', title: 'Searching for desktop LoRa…',
    detail: 'Waiting for receiver — Check USB/COM port',
  };
}

export function isReceiverUnavailable(message) {
  return message === 'Waiting for rover — Check USB/COM port'
    || message === 'Desktop LoRa receiver is not connected.';
}

// Presentation only: the backend remains the authority for phases and evidence.
export function getDeploymentFailure(deployment, actionError) {
  const message = deployment?.error || actionError?.message;
  if (!message || (!deployment?.error && actionError?.stage === 'prepare' && isReceiverUnavailable(message))) return null;
  let title = 'Unable to prepare mission deployment';
  let state = 'operation-failed';
  if (deployment?.failure_code === 'ACK_EXHAUSTED') {
    title = 'Unable to establish communication with the rover';
    state = 'transmission-failed';
  } else if (deployment?.failure_code === 'PROTOCOL_REQUIRED') {
    title = 'ESP32 mission protocol update required';
  } else if (deployment?.failure_code === 'ROVER_REJECTED') {
    title = 'Rover rejected the mission — operator recovery required';
  } else if (deployment?.failure_code === 'TX_COMPLETION_TIMEOUT') {
    title = 'Radio packet transmission was not confirmed';
    state = 'transmission-failed';
  } else if (/USB connection lost/i.test(message)) {
    title = 'Deployment interrupted — desktop LoRa disconnected';
    state = 'connection-failed';
  } else if (/Failed to restore desktop RX|RX restoration failed/i.test(message)) {
    title = 'Unable to restore desktop LoRa RX';
  } else if (/did not confirm TX|TX command failed/i.test(message)) {
    title = 'Failed to switch desktop LoRa to TX';
  } else if (/missing or mismatched mission ACK|no matching.*acknowledgment/i.test(message)) {
    title = 'No matching acknowledgment received from rover';
    state = 'transmission-failed';
  } else if (/No fresh rover telemetry/i.test(message)) {
    title = 'Rover telemetry has not resumed';
  } else if (/serial write failed/i.test(message)) {
    title = 'Desktop LoRa serial command failed';
  } else if (/transmission|mission packet/i.test(message)) {
    title = 'Mission transmission failed';
    state = 'transmission-failed';
  } else if (actionError?.stage === 'cancel') {
    title = 'Unable to cancel mission deployment';
  } else if (actionError?.stage === 'confirm') {
    title = 'Unable to confirm mission transmission';
  } else if (deployment?.phase === 'FAILED') {
    title = 'Mission deployment interrupted';
  }
  const detail = actionError?.message && deployment?.error && actionError.message !== deployment.error
    ? `${message} Additional action error: ${actionError.message}` : message;
  return {state, title, detail};
}

export function getDeploymentProgress(deployment, closing = false) {
  if (closing && !['FAILED','CANCELLED','COMPLETE'].includes(deployment?.phase)) return 'Cancelling — restoring desktop RX…';
  if (!deployment) return null;
  const {phase, attempt = 0, max_attempts = 8} = deployment;
  const count = `Attempt ${Math.max(1, attempt)} of ${max_attempts}`;
  return {
    PREPARING: 'Preparing desktop LoRa',
    SWITCH_TX: 'Switching to TX',
    READY: 'Desktop LoRa ready — confirm the rover safety checks',
    TRANSMITTING: `Transmitting mission — ${count}`,
    WAIT_ACK: `Waiting for rover acknowledgment — ${count}`,
    RETRYING: `No ACK received — Retrying (Attempt ${attempt + 1} of ${max_attempts})`,
    ACKNOWLEDGED: 'Rover acknowledged mission',
    SWITCH_RX: 'Restoring desktop RX',
    RESTORE: 'Waiting for fresh rover telemetry',
    COMPLETE: 'Rover acknowledged mission — telemetry restored',
    CANCELLED: 'Deployment cancelled',
  }[phase] || null;
}
