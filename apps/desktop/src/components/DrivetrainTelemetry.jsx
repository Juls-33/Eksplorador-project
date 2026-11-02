import React, { useId } from 'react';
import { useEncoderTelemetry } from '../hooks/useEncoderTelemetry';
import { rotationDirection, rpmDifferencePercent } from '../utils/encoderTelemetry';
import RpmHistoryChart from './RpmHistoryChart';
import './DrivetrainTelemetry.css';

const STATUS = { 'no-data': 'No Data', receiving: 'Receiving', stale: 'Stale', unavailable: 'Unavailable' };
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
const signedRPM = rpm => `${rpm > 0 ? '+' : ''}${rpm.toFixed(2)}`;

// Exported presentation makes the real card testable without a native receiver.
export function DrivetrainTelemetryCard({ snapshot, staleAfterMs, onTimeoutChange, title = 'Drivetrain Telemetry', children }) {
  const titleId = useId();
  const { packet, state, sincePacketMs, minimumAgeMs, listenerError } = snapshot;
  const rpmPacket = snapshot.rpmPacket ?? packet;
  const current = state === 'receiving' && !!rpmPacket;
  const counterState = snapshot.encoderState ?? state;
  const fusionRPM = snapshot.rpmSource === 'fusion';
  return (
    <section className="card drivetrain-telemetry" aria-labelledby={titleId}>
      <div className="card-header drivetrain-telemetry__header">
        <span className="card-title" id={titleId}>{title}</span>
        <span className={`drivetrain-telemetry__status drivetrain-telemetry__status--${state}`} role="status">{state === 'unavailable' && snapshot.disconnected ? 'Disconnected' : STATUS[state]}</span>
      </div>
      <div className="drivetrain-telemetry__body">
        {!packet && <p className="drivetrain-telemetry__note"><strong>{current ? 'No ENC counter data.' : 'No Data.'}</strong> Waiting for a standalone encoder packet. Fusion cannot supply ticks, errors or encoder sequence.</p>}
        {listenerError && <p className="drivetrain-telemetry__note">Encoder monitoring could not start. Reload the application to retry.</p>}
        {packet && !current && <p className="drivetrain-telemetry__note">Current RPM unavailable. Counts and errors below are from the last accepted packet.</p>}
        {snapshot.fusionEncoderInvalid && <p className="drivetrain-telemetry__note">Fusion reports encoderValid = 0; its RPM fallback is unavailable.</p>}
        <div className="drivetrain-telemetry__motors">
          {['left', 'right'].map(side => (
            <div className="drivetrain-telemetry__motor" key={side}>
              <h3>{side === 'left' ? 'Left' : 'Right'} Motor RPM</h3>
              <div className="drivetrain-telemetry__rpm">{current ? signedRPM(rpmPacket[`${side}RPM`]) : '—'} <small>RPM</small></div>
              <p>{current ? rotationDirection(rpmPacket[`${side}RPM`]) : 'Direction unavailable'}</p>
              <dl>
                <div><dt>Encoder ticks</dt><dd>{packet ? packet[`${side}Ticks`].toLocaleString() : '—'}</dd></div>
                <div><dt>Encoder errors</dt><dd>{packet ? packet[side === 'left' ? 'invalidL' : 'invalidR'].toLocaleString() : '—'}</dd></div>
              </dl>
            </div>
          ))}
        </div>
        <dl className="drivetrain-telemetry__metrics">
          <div><dt>RPM source</dt><dd>{snapshot.rpmSource ? fusionRPM ? 'Fusion fallback' : 'Standalone ENC' : '—'}</dd></div>
          <div><dt>RPM difference</dt><dd>{current ? `${rpmDifferencePercent(rpmPacket.leftRPM, rpmPacket.rightRPM).toFixed(2)}%` : '—'}</dd></div>
          <div><dt>RPM measurement age (minimum)</dt><dd>{rpmPacket ? seconds(snapshot.rpmMinimumAgeMs ?? minimumAgeMs) : '—'}</dd></div>
          <div><dt>{fusionRPM ? 'Reported encoder age (FUS)' : 'Age at transmit'}</dt><dd>{rpmPacket ? seconds(fusionRPM ? rpmPacket.encoderAgeMs : rpmPacket.ageAtTransmitMs) : '—'}</dd></div>
          <div><dt>RPM received</dt><dd>{rpmPacket ? new Date(rpmPacket.receivedAtMs).toLocaleTimeString() : '—'}</dd></div>
          {fusionRPM && <div><dt>RPM fusion sequence</dt><dd>{rpmPacket.fusionSeq}</dd></div>}
          <div className="drivetrain-telemetry__counter-status"><dt>ENC counters</dt><dd className={`drivetrain-telemetry__status drivetrain-telemetry__status--${counterState}`}>{STATUS[counterState]}</dd></div>
          <div><dt>Counter measurement age (minimum)</dt><dd>{packet ? seconds(minimumAgeMs) : '—'}</dd></div>
          <div><dt>Since last ENC packet</dt><dd>{packet ? seconds(sincePacketMs) : '—'}</dd></div>
          <div><dt>Encoder sequence</dt><dd>{packet ? packet.encoderSeq : '—'}</dd></div>
        </dl>
        {packet && counterState !== 'receiving' && <p className="drivetrain-telemetry__note">ENC counter readings are {counterState === 'stale' ? 'stale' : 'unavailable'}: ticks, errors and encoder sequence are from the last accepted ENC packet. Fresh fusion RPM does not refresh these counters.</p>}
        <label className="drivetrain-telemetry__timeout">Stale after
          <select value={staleAfterMs} onChange={event => onTimeoutChange(Number(event.target.value))}>
            <option value={3000}>3 seconds</option><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option>
          </select>
        </label>
        {children}
        <p className="drivetrain-telemetry__note">Direction follows the transmitted RPM sign; Forward/Reverse requires RPM calibration. RPM difference compares absolute motor speeds. Encoder rotation does not establish ground speed or distance.</p>
        <p className="drivetrain-telemetry__note">RPM age uses the selected source's reported encoder age plus desktop elapsed time. Counter age always uses standalone ENC. Radio transit time is unknown; these are minimum ages, not end-to-end latency.</p>
      </div>
    </section>
  );
}

export default function DrivetrainTelemetry({ expanded = false }) {
  const { snapshot, setStaleAfterMs } = useEncoderTelemetry();
  const card = (
    <DrivetrainTelemetryCard snapshot={snapshot} staleAfterMs={snapshot.staleAfterMs} onTimeoutChange={setStaleAfterMs}
      title={expanded ? 'Drivetrain Monitoring' : 'Drivetrain Telemetry'}>
      {expanded && <RpmHistoryChart history={snapshot.history} nowMs={snapshot.nowMs} state={snapshot.state} />}
    </DrivetrainTelemetryCard>
  );
  return expanded ? <div className="drivetrain-monitoring">{card}</div> : card;
}
