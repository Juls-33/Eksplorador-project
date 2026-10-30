import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createLoRaConnectionStore } from '../services/loraConnectionStore';

const connectionStore = createLoRaConnectionStore({ listen, invoke });

export const refreshLoRaConnection = () => connectionStore.refresh();

export function useLoRaConnection() {
  return useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot);
}
