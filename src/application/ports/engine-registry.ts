import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';

// Holds the engine used by the application dispatcher.
let installed: DataEnginePort = unavailableDataEngine;

export const registerDataEngine = (engine: DataEnginePort): void => {
  installed = engine;
};

/*
 * Stable engine port that delegates to the currently registered implementation.
 *
 * Every method forwards its full argument list: dropping optional arguments here would silently
 * disable import progress reporting and query scheduling for callers that use this port.
 */
export const registeredDataEngine: DataEnginePort = {
  importFile: (...args) => installed.importFile(...args),
  fetchTableWindow: (...args) => installed.fetchTableWindow(...args),
  executeAnalysis: (...args) => installed.executeAnalysis(...args),
  getDistinctValues: (...args) => installed.getDistinctValues(...args),
  getColumnStatistics: (...args) => installed.getColumnStatistics(...args),
  getColumnRange: (...args) => installed.getColumnRange(...args),
  measureKeyQuality: (...args) => installed.measureKeyQuality(...args),
  dropDataset: (...args) => installed.dropDataset(...args),
};
