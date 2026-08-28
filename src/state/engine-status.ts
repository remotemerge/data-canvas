import { createStore } from 'zustand/vanilla';
import type { DomainError } from '@/shared/errors/domain-error.ts';

/**
 * Whether the analytical engine is up.
 *
 * Kept in its own store rather than in the workspace. Engine readiness is a property of this
 * browser session, not of the workspace document: it is not revisioned, not attributable, and must
 * not be persisted or exported, all of which would follow from putting it in the aggregate.
 *
 * This module holds no reference to the engine itself, so the UI can subscribe to readiness
 * without dragging DuckDB-Wasm into every module that renders.
 */
export type EngineStatus = 'idle' | 'starting' | 'ready' | 'failed';

export interface EngineState {
  status: EngineStatus;
  error: DomainError | null;
}

export const engineStore = createStore<EngineState>()(() => ({ status: 'idle', error: null }));

export const setEngineStarting = (): void => engineStore.setState({ status: 'starting', error: null });

export const setEngineReady = (): void => engineStore.setState({ status: 'ready', error: null });

export const setEngineFailed = (error: DomainError): void => engineStore.setState({ status: 'failed', error });
