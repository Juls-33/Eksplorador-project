import React from 'react';
import { AlertTriangle, Radio, Wifi, WifiOff } from 'lucide-react';
import { getConnectionStatus } from '../utils/loraStatus';
import './LoRaConnectionStatus.css';

export default function LoRaConnectionStatus({ connection, failure = null, compact = false }) {
  const status = getConnectionStatus(connection);
  const Icon = status.state === 'connected' ? Wifi
    : status.state === 'connection-failed' ? AlertTriangle
    : status.state === 'disconnected' ? WifiOff : Radio;
  return (
    <div className={`lora-connection-status${compact ? ' lora-connection-status--compact' : ''}`}>
      <div className={`lora-connection-status__connection lora-connection-status--${status.state}`} role="status" aria-live="polite" aria-atomic="true">
        <span className="lora-connection-status__signal" aria-hidden="true">
          {status.state === 'searching' && <><span className="lora-connection-status__ring"/><span className="lora-connection-status__ring"/></>}
          <Icon size={20}/>
        </span>
        <div className="lora-connection-status__copy">
          <strong>{status.title}</strong>
          <p>{status.detail}</p>
          {!compact && status.state === 'connected' && <p>Rover reception is verified separately by mission ACK and live telemetry.</p>}
        </div>
      </div>
      {failure && <div className={`lora-connection-status__failure lora-connection-status--${failure.state}`} role="alert">
        <AlertTriangle size={18} aria-hidden="true"/>
        <div className="lora-connection-status__copy"><strong>{failure.title}</strong><p>{failure.detail}</p></div>
      </div>}
    </div>
  );
}
