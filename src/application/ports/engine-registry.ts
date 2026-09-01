import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';

// Holds the engine used by the application dispatcher.
let installed: DataEnginePort = unavailableDataEngine;

export const registerDataEngine = (engine: DataEnginePort): void => {
  installed = engine;
};

// Stable engine port that delegates to the currently registered implementation.
export const registeredDataEngine: DataEnginePort = {
  importFile: (file, datasetId) => installed.importFile(file, datasetId),
  fetchTableWindow: (request) => installed.fetchTableWindow(request),
  executeAnalysis: (query) => installed.executeAnalysis(query),
  getDistinctValues: (request) => installed.getDistinctValues(request),
  getColumnStatistics: (request) => installed.getColumnStatistics(request),
  getColumnRange: (request) => installed.getColumnRange(request),
  measureKeyQuality: (request) => installed.measureKeyQuality(request),
  dropDataset: (datasetId) => installed.dropDataset(datasetId),
};
