import React, { useId } from 'react';
import { ENCODER_HISTORY_MS } from '../services/encoderTelemetryStore.js';

const LEFT = 54, TOP = 18, WIDTH = 524, HEIGHT = 164;
const tickLabel = value => Math.abs(value) >= 10000 ? value.toExponential(1) : String(value);

export default function RpmHistoryChart({ history, nowMs, state }) {
  const titleId = useId();
  const maxRPM = Math.max(1, ...history.flatMap(point => [Math.abs(point.leftRPM), Math.abs(point.rightRPM)]));
  const scale = maxRPM <= 1 ? 1 : Math.ceil(maxRPM / 10) * 10;
  const x = at => LEFT + Math.max(0, Math.min(1, 1 - (nowMs - at) / ENCODER_HISTORY_MS)) * WIDTH;
  const y = rpm => TOP + HEIGHT / 2 * (1 - rpm / scale);
  const path = side => history.map((point, i) => `${!i || point.breakBefore ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point[side]).toFixed(1)}`).join(' ');
  const last = history.at(-1);
  return (
    <figure className={`rpm-history${state === 'receiving' ? '' : ' rpm-history--inactive'}`}>
      <figcaption>
        <strong>Motor RPM history</strong><span>Last 60 seconds · signed RPM</span>
      </figcaption>
      <div className="rpm-history__legend"><span className="rpm-history__left">━ Left motor</span><span className="rpm-history__right">┄ Right motor</span></div>
      {!history.length ? <div className="rpm-history__empty">Waiting for fresh encoder measurements.</div> : (
        <svg viewBox="0 0 600 218" role="img" aria-labelledby={titleId}>
          <title id={titleId}>Left and right signed motor RPM over the last 60 seconds. Gaps indicate unavailable telemetry.</title>
          {[scale, 0, -scale].map(value => (
            <g key={value}>
              <line x1={LEFT} x2={LEFT + WIDTH} y1={y(value)} y2={y(value)} className="rpm-history__grid" />
              <text x={LEFT - 8} y={y(value) + 4} textAnchor="end">{tickLabel(value)}</text>
            </g>
          ))}
          <path d={path('leftRPM')} className="rpm-history__trace rpm-history__trace--left" />
          <path d={path('rightRPM')} className="rpm-history__trace rpm-history__trace--right" />
          <circle cx={x(last.at)} cy={y(last.leftRPM)} r="3" className="rpm-history__point--left" />
          <circle cx={x(last.at)} cy={y(last.rightRPM)} r="3" className="rpm-history__point--right" />
          <text x={LEFT} y="206">60 s ago</text><text x={LEFT + WIDTH / 2} y="206" textAnchor="middle">30 s ago</text><text x={LEFT + WIDTH} y="206" textAnchor="end">Now</text>
        </svg>
      )}
      <p className="drivetrain-telemetry__note">{state === 'receiving' ? 'Recent motor rotation measurements from ENC or fusion fallback.' : 'History only — live RPM is unavailable.'} Gaps are not interpolated. Source changes start a new trace. History clears on receiver disconnect.</p>
    </figure>
  );
}
