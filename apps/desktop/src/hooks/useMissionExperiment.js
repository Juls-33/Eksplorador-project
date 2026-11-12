import { useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createMissionExperimentRecorder } from '../services/missionExperimentRecorder';

export const missionExperiment = createMissionExperimentRecorder({listen});
export const useMissionExperiment = () => useSyncExternalStore(missionExperiment.subscribe, missionExperiment.getSnapshot);
