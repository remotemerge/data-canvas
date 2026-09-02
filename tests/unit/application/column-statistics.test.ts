import { describe, expect, test } from 'bun:test';
import type { ColumnStatisticsRequest, DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { getColumnProfile } from '@/application/queries/column-statistics.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import { stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const statisticsEngine = (record: (request: ColumnStatisticsRequest) => void): DataEnginePort => ({
  ...stubDataEngine(),
  getColumnStatistics: (request) => {
    record(request);

    return Promise.resolve(
      ok({
        rowCount: 10,
        nullCount: 1,
        distinctCount: 3,
        distinctCountCapped: true,
        min: 1,
        max: 9,
        mean: 4,
        median: 4,
        stddev: 2,
        topValues: [{ value: 'West', count: 2 }],
      }),
    );
  },
});

// Two filters on the sales dataset, only one of them enabled.
const filteredWorkspace = (): Workspace => {
  const workspace = workspaceWithDataset();
  workspace.filters['enabled'] = {
    id: 'enabled',
    datasetId: 'ds_sales',
    columnId: 'col_region',
    operator: 'eq',
    value: 'West',
    enabled: true,
    origin: 'human',
    createdBy: 'human',
  };
  workspace.filters['disabled'] = {
    id: 'disabled',
    datasetId: 'ds_sales',
    columnId: 'col_region',
    operator: 'eq',
    value: 'East',
    enabled: false,
    origin: 'human',
    createdBy: 'human',
  };

  return workspace;
};

describe('column profile', () => {
  test('an unknown dataset is refused before the engine is asked', async () => {
    let asked = false;
    const engine = statisticsEngine(() => {
      asked = true;
    });
    const result = await getColumnProfile(engine, workspaceWithDataset(), 'ds_missing', 'col_revenue');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DATASET_NOT_FOUND');
    }
    expect(asked).toBe(false);
  });

  test('an unknown column is refused before the engine is asked', async () => {
    const result = await getColumnProfile(
      statisticsEngine(() => {}),
      workspaceWithDataset(),
      'ds_sales',
      'col_missing',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  // The profile describes what the user is looking at, so the active filters apply to it.
  test('passes the enabled filters for the dataset and drops the disabled ones', async () => {
    let request: ColumnStatisticsRequest | undefined;
    const engine = statisticsEngine((value) => {
      request = value;
    });
    await getColumnProfile(engine, filteredWorkspace(), 'ds_sales', 'col_revenue', 3);

    expect(request).toMatchObject({ datasetId: 'ds_sales', columnId: 'col_revenue', topValueLimit: 3 });
    expect(request?.filters).toHaveLength(1);
    expect(request?.filters?.[0]?.id).toBe('enabled');
  });

  test('omits the top-value limit when the caller does not set one', async () => {
    let request: ColumnStatisticsRequest | undefined;
    const engine = statisticsEngine((value) => {
      request = value;
    });
    await getColumnProfile(engine, workspaceWithDataset(), 'ds_sales', 'col_revenue');

    expect(request).not.toHaveProperty('topValueLimit');
  });

  test('returns the engine statistics alongside the column identity', async () => {
    const result = await getColumnProfile(
      statisticsEngine(() => {}),
      workspaceWithDataset(),
      'ds_sales',
      'col_revenue',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toMatchObject({
      columnId: 'col_revenue',
      name: 'revenue',
      logicalType: 'number',
      distinctCount: 3,
      distinctCountCapped: true,
    });
  });

  test('an engine failure is returned rather than reported as an empty profile', async () => {
    const engine: DataEnginePort = {
      ...stubDataEngine(),
      getColumnStatistics: () => Promise.resolve(err(domainError('ENGINE_UNAVAILABLE', 'offline'))),
    };
    const result = await getColumnProfile(engine, workspaceWithDataset(), 'ds_sales', 'col_revenue');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ENGINE_UNAVAILABLE');
    }
  });
});
