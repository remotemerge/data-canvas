import { registerDataEngine } from '@/application/ports/engine-registry.ts';
import { engineStore, setEngineFailed, setEngineReady, setEngineStarting } from '@/state/engine-status.ts';
import { workspaceStore } from '@/state/workspace-store.ts';

let stopEngineSync: (() => void) | null = null;

/**
 * Starts DuckDB-Wasm and registers it as the application's data engine.
 *
 * Bootstrap is the only browser-specific module that knows the concrete engine. Dynamic import
 * keeps the worker out of the initial chunk. Repeated calls return while startup is in progress or
 * complete, which makes this safe for React StrictMode.
 */
export const startEngine = async (): Promise<void> => {
  const { status } = engineStore.getState();

  if (status === 'ready' || status === 'starting') {
    return;
  }

  setEngineStarting();

  try {
    const { dataEngine } = await import('@/data/duckdb/data-engine.ts');
    const result = await dataEngine.initialize();

    if (!result.ok) {
      setEngineFailed(result.error);

      return;
    }

    dataEngine.setRelationships(workspaceStore.getState().workspace.relationships);
    dataEngine.setDerivedColumns(workspaceStore.getState().workspace.derivedColumns);
    const unsubscribe = workspaceStore.subscribe((state) => {
      // Push definitions on each commit so the engine can compile queries without reading the store.
      dataEngine.setRelationships(state.workspace.relationships);
      dataEngine.setDerivedColumns(state.workspace.derivedColumns);
    });
    stopEngineSync?.();
    stopEngineSync = unsubscribe;

    // Register only after initialization succeeds.
    registerDataEngine(dataEngine);
    setEngineReady();
  } catch {
    // Surface load failures through engine state so the UI does not remain stuck at 'starting'.
    setEngineFailed({
      code: 'ENGINE_UNAVAILABLE',
      message: 'The analytical engine could not be loaded.',
    });
  }
};
