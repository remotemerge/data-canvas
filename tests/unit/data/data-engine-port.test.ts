import { afterEach, describe, expect, test } from 'bun:test';
import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { registerDataEngine, registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import { stubDataEngine } from '../application/action-fixtures.ts';

const COUNT_QUERY: AnalysisQuery = {
  datasetId: 'ds_sales',
  dimensions: [],
  measures: [{ aggregate: 'count' }],
  filters: [],
};

// Calls every port method so a new method cannot be added without a delegation assertion.
const callEveryMethod = async (engine: DataEnginePort, datasetId: string) =>
  Promise.all([
    engine.importFile({}, datasetId),
    engine.fetchTableWindow({} as Parameters<DataEnginePort['fetchTableWindow']>[0]),
    engine.executeAnalysis(COUNT_QUERY),
    engine.getDistinctValues({} as Parameters<DataEnginePort['getDistinctValues']>[0]),
    engine.getColumnStatistics({} as Parameters<DataEnginePort['getColumnStatistics']>[0]),
    engine.getColumnRange({} as Parameters<DataEnginePort['getColumnRange']>[0]),
    engine.measureKeyQuality({} as Parameters<DataEnginePort['measureKeyQuality']>[0]),
    engine.dropDataset(datasetId),
  ]);

describe('unavailableDataEngine', () => {
  // The default port must fail every call rather than silently returning empty analytical results.
  test('rejects every operation instead of returning empty data', async () => {
    const results = await callEveryMethod(unavailableDataEngine, 'ds_missing');

    expect(results.every((result) => !result.ok)).toBe(true);
  });
});

describe('registeredDataEngine', () => {
  // The registry holds module state, so an installed engine must not leak into unrelated tests.
  afterEach(() => {
    registerDataEngine(unavailableDataEngine);
  });

  test('delegates every operation to the installed engine', async () => {
    registerDataEngine(stubDataEngine());

    const results = await callEveryMethod(registeredDataEngine, 'ds_sales');

    expect(results.every((result) => result.ok)).toBe(true);
  });

  test('falls back to the unavailable engine before one is installed', async () => {
    registerDataEngine(unavailableDataEngine);

    expect((await registeredDataEngine.dropDataset('ds_sales')).ok).toBe(false);
  });
});
