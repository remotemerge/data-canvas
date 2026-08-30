import { registerDataEngine } from '@/application/ports/engine-registry.ts';
import { engineStore, setEngineFailed, setEngineReady, setEngineStarting } from '@/state/engine-status.ts';
import { createCheckpointScheduler, writeCheckpoint } from '@/data/persistence/checkpoint.ts';
import { hydrateWorkspace } from '@/data/persistence/hydrate-workspace.ts';
import { createMetadataTables } from '@/data/persistence/schema/metadata-tables.ts';
import { hydrateWorkspaceState, workspaceStore } from '@/state/workspace-store.ts';

let stopPersistence: (() => void) | null = null;

/**
 * Brings DuckDB up and installs it as the application's engine.
 *
 * The only place that knows both that the engine is DuckDB-Wasm and that the application is running
 * in a browser. Everything else works against `DataEnginePort`.
 *
 * The engine module is imported dynamically. A static import would make the DuckDB worker a
 * dependency of anything transitively reaching bootstrap; loading it here also keeps the Wasm
 * bundle out of the initial chunk, so the shell paints before the engine is fetched.
 *
 * Safe to call more than once: it returns early once starting or ready, which React StrictMode's
 * double-invoked effects in development require.
 */
export const startEngine = async (): Promise<void> => {
  const { status } = engineStore.getState();

  if (status === 'ready' || status === 'starting') return;

  setEngineStarting();

  try {
    const { dataEngine } = await import('@/data/duckdb/data-engine.ts');
    const result = await dataEngine.initialize();

    if (!result.ok) {
      setEngineFailed(result.error);

      return;
    }

    const database = dataEngine.persistenceDatabase();
    if (database === null) throw new Error('DuckDB opened without a persistence connection.');
    await createMetadataTables(database);
    const hydrated = await hydrateWorkspace(database);
    if (hydrated !== null && hydrated.warnings.length === 0) {
      hydrateWorkspaceState(hydrated.workspace, hydrated.history, hydrated.undoStack, hydrated.redoStack);
      dataEngine.restoreDatasets(hydrated.workspace.datasets);
    }

    // A workspace this build cannot migrate stays readable on disk. Registering the checkpoint
    // subscription would let the empty in-memory workspace be written over a file saved by a newer
    // build on the very first action, so the session continues in memory without persistence.
    if (hydrated?.blocked === true) {
      window.dispatchEvent(new CustomEvent('data-canvas:persistence-blocked'));
      registerDataEngine(dataEngine);
      setEngineReady();

      return;
    }
    dataEngine.setRelationships(workspaceStore.getState().workspace.relationships);
    dataEngine.setDerivedColumns(workspaceStore.getState().workspace.derivedColumns);
    const scheduler = createCheckpointScheduler(
      async (state) => {
        await writeCheckpoint(database, state);
        // Announced only after the checkpoint has flushed to OPFS. A storage estimate taken before
        // this point still reports the pre-write size, so anything showing usage must wait for it.
        window.dispatchEvent(new CustomEvent('data-canvas:persistence-saved'));
      },
      500,
      () => window.dispatchEvent(new CustomEvent('data-canvas:persistence-error')),
    );
    const unsubscribe = workspaceStore.subscribe((state) => {
      // The engine compiles joins and derived expressions and so needs both definitions, but must
      // not read the store itself. Pushing on every commit keeps its copy in step without that
      // dependency.
      dataEngine.setRelationships(state.workspace.relationships);
      dataEngine.setDerivedColumns(state.workspace.derivedColumns);
      scheduler.schedule(state);
    });
    const flushOnLeave = (): void => {
      if (document.visibilityState === 'hidden') void scheduler.flush();
    };
    const flushOnPageHide = (): void => void scheduler.flush();
    document.addEventListener('visibilitychange', flushOnLeave);
    window.addEventListener('pagehide', flushOnPageHide);
    stopPersistence?.();
    stopPersistence = () => {
      unsubscribe();
      scheduler.dispose();
      document.removeEventListener('visibilitychange', flushOnLeave);
      window.removeEventListener('pagehide', flushOnPageHide);
    };

    // Registered only after a successful start, so the dispatcher never routes an action to an
    // engine that failed to come up.
    registerDataEngine(dataEngine);
    setEngineReady();
  } catch {
    // A failure to even load the engine chunk — offline, blocked asset — must still surface as a
    // reported state rather than an unhandled rejection that leaves the UI showing 'starting'.
    setEngineFailed({
      code: 'ENGINE_UNAVAILABLE',
      message: 'The analytical engine could not be loaded.',
    });
  }
};
