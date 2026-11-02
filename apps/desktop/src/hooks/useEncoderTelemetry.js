import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createEncoderTelemetryStore } from '../services/encoderTelemetryStore.js';

const encoderStore = createEncoderTelemetryStore({ listen });

// Mounted once by App, independently of which operational view is visible.
export function useEncoderTelemetrySource(receiver) {
  useEffect(() => encoderStore.start(), []);
  useLayoutEffect(() => {
    encoderStore.setReceiver(receiver);
  }, [receiver.connected, receiver.port, receiver.connectionError]);
}

export function useEncoderTelemetry() {
  const snapshot = useSyncExternalStore(encoderStore.subscribe, encoderStore.getSnapshot);
  return { snapshot, setStaleAfterMs: encoderStore.setStaleAfterMs };
}
