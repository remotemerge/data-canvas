import { useStore } from 'zustand';
import { engineStore } from '@/state/engine-status.ts';
import type { EngineState } from '@/state/engine-status.ts';

// Read-only React view of engine readiness.
export const useEngineStatus = <T>(selector: (state: EngineState) => T): T => useStore(engineStore, selector);

export const selectEngineStatus = (state: EngineState): EngineState['status'] => state.status;

export const selectEngineError = (state: EngineState): EngineState['error'] => state.error;
