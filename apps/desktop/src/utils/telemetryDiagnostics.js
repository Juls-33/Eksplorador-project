// Temporary opt-in browser diagnostics. The default path stays quiet even when
// diagnostic serial traffic is frequent. Enable in DevTools, then reload:
// sessionStorage.setItem('eksplorador.telemetryDebug', '1')
export function telemetryDiagnostic(stage, details) {
  try {
    if (globalThis.sessionStorage?.getItem('eksplorador.telemetryDebug') === '1') {
      console.debug(`[telemetry:${stage}]`, details);
    }
  } catch { /* Restricted storage must never interrupt telemetry reception. */ }
}
