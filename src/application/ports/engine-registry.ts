import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';

/**
 * Holds the engine the application dispatcher uses.
 *
 * Indirection with a purpose. If the dispatcher imported the DuckDB engine directly, every module
 * that reaches the dispatcher — which is nearly all of them, including every unit test — would pull
 * in `@duckdb/duckdb-wasm` and its Wasm worker. That worker only runs in a browser, so the test
 * runner would fail on modules that never intended to touch the engine at all.
 *
 * Registration therefore happens once, from `src/app/bootstrap/`, which is the only place that
 * knows the application is running in a browser.
 *
 * Until then the port reports `ENGINE_UNAVAILABLE`, so an import attempted before startup finishes
 * fails with a typed error instead of a crash.
 */
let installed: DataEnginePort = unavailableDataEngine;

export const registerDataEngine = (engine: DataEnginePort): void => {
  installed = engine;
};

/**
 * The engine as a stable façade.
 *
 * Delegating per call rather than returning the current engine object means the dispatcher can be
 * constructed before the engine exists and still reach the real one afterwards.
 */
export const registeredDataEngine: DataEnginePort = {
  importFile: (file, datasetId) => installed.importFile(file, datasetId),
  fetchTableWindow: (request) => installed.fetchTableWindow(request),
  executeAnalysis: (query) => installed.executeAnalysis(query),
  getDistinctValues: (request) => installed.getDistinctValues(request),
};
