import { createEncoderMonitor, createFusionRpmMonitor, encoderEventRejectionReason, fusionEventRejectionReason, DEFAULT_ENCODER_STALE_MS, ENCODER_UI_INTERVAL_MS } from '../utils/encoderTelemetry.js';
import { telemetryDiagnostic } from '../utils/telemetryDiagnostics.js';

export const ENCODER_HISTORY_MS = 60_000;
export const ENCODER_HISTORY_LIMIT = 600;

// One app-owned subscription per stream and one cached snapshot. Views subscribe
// to this store; mounting/unmounting a card cannot reset telemetry or its clock.
export function createEncoderTelemetryStore({
  listen, clock = () => performance.now(), wallClock = () => Date.now(),
  schedule = setInterval, cancel = clearInterval,
  diagnostic = telemetryDiagnostic,
}) {
  const monitor = createEncoderMonitor({ clock, wallClock });
  const fusionMonitor = createFusionRpmMonitor({ clock, wallClock });
  const subscribers = new Set();
  let receiver = { connected: false, port: null, connectionError: null };
  let staleAfterMs = DEFAULT_ENCODER_STALE_MS;
  let history = [], running = false, generation = 0;
  let listenerErrors = { encoder: false, fusion: false }, fusionEncoderInvalid = false;
  let historyGap = true;
  let lastHistoryPacket = null;

  const connected = () => running && receiver.connected && !receiver.connectionError;
  const measurements = () => {
    const encoder = monitor.snapshot(connected() && !listenerErrors.encoder, staleAfterMs);
    const fusion = fusionMonitor.snapshot(connected() && !listenerErrors.fusion, staleAfterMs);
    // Fresh standalone ENC is authoritative. Only RPM can fall back to FUS.
    const useFusion = encoder.state !== 'receiving' && fusion.packet
      && (fusion.state === 'receiving' || !encoder.packet || fusion.minimumAgeMs < encoder.minimumAgeMs);
    const rpm = useFusion ? fusion : encoder;
    return { ...encoder, encoderState: encoder.state, fusionPacket: fusion.packet,
      fusionState: fusion.state, rpmPacket: rpm.packet,
      rpmSource: rpm.packet ? (useFusion ? 'fusion' : 'encoder') : null,
      rpmMinimumAgeMs: rpm.minimumAgeMs, rpmSincePacketMs: rpm.sincePacketMs,
      state: !connected() ? 'unavailable' : fusionEncoderInvalid && !rpm.packet ? 'unavailable' : rpm.state,
      fusionEncoderInvalid, listenerError: listenerErrors.encoder && listenerErrors.fusion };
  };
  let snapshot = { ...measurements(), history, staleAfterMs, disconnected: true, nowMs: clock() };
  const pruneHistory = now => {
    // Switching to cached fresh FUS may select an earlier receipt time than the
    // last ENC point; do not assume history receipt times are globally sorted.
    const recent = history.filter(point => now - point.at <= ENCODER_HISTORY_MS);
    if (recent.length !== history.length) history = recent;
  };
  const recordHistory = (reading, now) => {
    pruneHistory(now);
    if (reading.state !== 'receiving') { historyGap = true; return; }
    if (reading.rpmPacket === lastHistoryPacket) return;
    const sourceChanged = history.length && history.at(-1).source !== reading.rpmSource;
    history = [...history, {
      at: now - reading.rpmSincePacketMs,
      leftRPM: reading.rpmPacket.leftRPM, rightRPM: reading.rpmPacket.rightRPM,
      source: reading.rpmSource,
      breakBefore: historyGap || !!sourceChanged || (history.length > 0 && now - history.at(-1).at >= staleAfterMs),
    }].slice(-ENCODER_HISTORY_LIMIT);
    lastHistoryPacket = reading.rpmPacket;
    historyGap = false;
  };
  const publish = () => {
    const nowMs = clock();
    const reading = measurements();
    recordHistory(reading, nowMs);
    const next = { ...reading, history, staleAfterMs,
      disconnected: !receiver.connected, nowMs };
    if (Object.keys(next).every(key => key === 'nowMs' || next[key] === snapshot[key])) return;
    if (next.rpmSource !== snapshot.rpmSource || next.state !== snapshot.state) {
      diagnostic('rpm_source_selected', { source: next.rpmSource, rpmState: next.state, counterState: next.encoderState });
    }
    snapshot = next;
    subscribers.forEach(notify => notify());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(notify) { subscribers.add(notify); return () => subscribers.delete(notify); },
    setReceiver(next) {
      if (next.connected !== receiver.connected || next.port !== receiver.port) {
        monitor.reset();
        fusionMonitor.reset();
        fusionEncoderInvalid = false;
        lastHistoryPacket = null;
        history = [];
      }
      receiver = next;
      publish(); // USB loss immediately masks RPM in every subscriber.
    },
    setStaleAfterMs(value) {
      if (![3000, 5000, 10000].includes(value)) return;
      staleAfterMs = value;
      publish();
    },
    start() {
      if (running) return () => {};
      running = true;
      listenerErrors = { encoder: false, fusion: false };
      const epoch = ++generation;
      const stops = [];
      // Native code already validates/orders/coalesces packets. Preserve that
      // pipeline; frontend validation remains the existing monitor's safeguard.
      const accept = source => event => {
        if (!running || epoch !== generation || !connected()) {
          diagnostic('rejected', { source, reason: 'inactive_lifecycle_or_receiver_disconnected' });
          return;
        }
        const reason = source === 'encoder' ? encoderEventRejectionReason(event.payload) : fusionEventRejectionReason(event.payload);
        if (reason) {
          diagnostic('rejected', { source, reason, packet: event.payload });
          return;
        }
        const wasFusionInvalid = fusionEncoderInvalid;
        if (source === 'fusion') {
          fusionEncoderInvalid = event.payload.encoderValid === 0;
          if (fusionEncoderInvalid) fusionMonitor.reset();
          else fusionMonitor.accept(event.payload);
        } else monitor.accept(event.payload);
        diagnostic(source === 'encoder' ? 'encoder_state_updated' : 'fusion_rpm_updated', {
          encoderSeq: event.payload.encoderSeq, fusionSeq: event.payload.fusionSeq,
          leftRPM: event.payload.leftRPM, rightRPM: event.payload.rightRPM, encoderValid: event.payload.encoderValid,
          reportedAgeMs: event.payload.ageAtTransmitMs ?? event.payload.encoderAgeMs, receivedAtMs: event.payload.receivedAtMs,
        });
        recordHistory(measurements(), clock());
        if (source === 'fusion' && fusionEncoderInvalid && !wasFusionInvalid) publish();
        // The shared timer publishes at 10 Hz; packet bursts cannot repaint
        // the dashboard on every event or rerender App's maps/tables.
      };
      for (const source of ['encoder', 'fusion']) {
        Promise.resolve().then(() => {
          if (running && epoch === generation) return listen(`${source}-data`, accept(source));
        }).then(unlisten => {
          if (!unlisten) return;
          if (!running || epoch !== generation) unlisten();
          else stops.push(unlisten);
        }).catch(error => {
          if (running && epoch === generation) {
            listenerErrors[source] = true;
            diagnostic('rejected', { source, reason: 'listener_setup_failed', error: String(error) });
            publish();
          }
        });
      }
      const timer = schedule(publish, ENCODER_UI_INTERVAL_MS);
      publish();
      return () => {
        if (epoch !== generation) return;
        running = false;
        generation += 1;
        cancel(timer);
        stops.forEach(stop => stop());
        monitor.reset();
        fusionMonitor.reset();
        fusionEncoderInvalid = false;
        lastHistoryPacket = null;
        history = [];
        publish();
      };
    },
  };
}
