import { createStore } from 'zustand/vanilla';
import type { DomainError } from '@/shared/errors/domain-error.ts';

// Engine readiness for the current browser session.
export type EngineStatus = 'idle' | 'starting' | 'ready' | 'failed';

export interface EngineState {
  status: EngineStatus;
  error: DomainError | null;
}

export const engineStore = createStore<EngineState>()(() => ({ status: 'idle', error: null }));

export const setEngineStarting = (): void => engineStore.setState({ status: 'starting', error: null });

export const setEngineReady = (): void => engineStore.setState({ status: 'ready', error: null });

export const setEngineFailed = (error: DomainError): void => engineStore.setState({ status: 'failed', error });
