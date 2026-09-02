import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleCreateMetric as rawHandleCreateMetric,
  handleRemoveMetric as rawHandleRemoveMetric,
  handleUpdateMetric as rawHandleUpdateMetric,
  MAX_METRIC_NAME_LENGTH,
} from '@/application/actions/handlers/metric-handlers.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import { salesDataset, stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const deps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };

type HandlerResult = Result<HandlerOutcome, DomainError>;

// Narrows the handler union to its synchronous result and supplies the default dependencies.
const sync =
  <TPayload>(handler: ActionHandler<TPayload>): ((workspace: Workspace, payload: TPayload) => HandlerResult) =>
  (workspace, payload) =>
    handler(workspace, payload, deps) as HandlerResult;

const createMetric = sync(rawHandleCreateMetric);
const updateMetric = sync(rawHandleUpdateMetric);
const removeMetric = sync(rawHandleRemoveMetric);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

const NUMERIC_COLUMN = 'col_revenue';
const DATE_COLUMN = 'col_date';

const SALES_FILTER: Filter = {
  id: 'filter_sales',
  datasetId: 'ds_sales',
  columnId: 'col_region',
  operator: 'eq',
  value: 'West',
  enabled: true,
  origin: 'human',
  createdBy: 'human',
};

const workspaceWithFilter = (): Workspace => ({
  ...workspaceWithDataset(),
  filters: { [SALES_FILTER.id]: SALES_FILTER },
});

// Adds a second dataset carrying its own filter, so cross-dataset filter references can be rejected.
const withForeignFilter = (workspace: Workspace): Workspace => {
  const otherDataset = { ...salesDataset('ds_other'), name: 'Other' };

  return {
    ...workspace,
    datasets: { ...workspace.datasets, [otherDataset.id]: otherDataset },
    filters: {
      ...workspace.filters,
      filter_other: { ...SALES_FILTER, id: 'filter_other', datasetId: otherDataset.id },
    },
  };
};

// A percent-of-total metric filtered to one region, plus its id.
const workspaceWithMetric = (): { workspace: Workspace; metricId: string } => {
  const created = createMetric(workspaceWithFilter(), {
    datasetId: 'ds_sales',
    name: 'Share',
    aggregate: 'sum',
    columnId: NUMERIC_COLUMN,
    filters: [SALES_FILTER.id],
    modifier: { kind: 'percentOfTotal' },
  });

  if (!created.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: created.value.workspace, metricId: created.value.changedEntityIds[0]! };
};

// A row-count metric, plus its id.
const workspaceWithCountMetric = (): { workspace: Workspace; metricId: string } => {
  const created = createMetric(workspaceWithDataset(), {
    datasetId: 'ds_sales',
    name: '  Rows  ',
    aggregate: 'count',
    modifier: { kind: 'none' },
  });

  if (!created.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: created.value.workspace, metricId: created.value.changedEntityIds[0]! };
};

describe('metric format defaults', () => {
  // A proportional modifier defaults to percent so a ratio is not shown as a bare decimal.
  test('a percent-of-total metric defaults to percent formatting', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(workspace.metrics[metricId]?.format).toEqual({ style: 'percent' });
  });

  test('an explicit format overrides the proportional default', () => {
    const created = createMetric(workspaceWithFilter(), {
      datasetId: 'ds_sales',
      name: 'Share',
      aggregate: 'sum',
      columnId: NUMERIC_COLUMN,
      modifier: { kind: 'percentOfTotal' },
      format: { style: 'currency', currency: 'USD' },
    });

    expect(created.ok).toBe(true);
    expect(created.ok && created.value.workspace.metrics[created.value.changedEntityIds[0]!]?.format).toEqual({
      style: 'currency',
      currency: 'USD',
    });
  });

  // A metric with no proportional modifier carries no format, leaving rendering to the default.
  test('a plain metric receives no format', () => {
    const { workspace, metricId } = workspaceWithCountMetric();

    expect(workspace.metrics[metricId]?.format).toBeUndefined();
  });
});

describe('handleCreateMetric', () => {
  test('rejects a name that is blank once trimmed', () => {
    expect(
      failureCode(createMetric(workspaceWithDataset(), { datasetId: 'ds_sales', name: ' ', aggregate: 'count' })),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects a name longer than the name budget', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'x'.repeat(MAX_METRIC_NAME_LENGTH + 1),
          aggregate: 'count',
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(
      failureCode(createMetric(workspaceWithDataset(), { datasetId: 'missing', name: 'Count', aggregate: 'count' })),
    ).toBe('DATASET_NOT_FOUND');
  });

  test('rejects a count aggregate given a column', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Bad count',
          aggregate: 'count',
          columnId: NUMERIC_COLUMN,
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects a column aggregate with no column', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), { datasetId: 'ds_sales', name: 'Missing column', aggregate: 'sum' }),
      ),
    ).toBe('INCOMPATIBLE_COLUMN');
  });

  test('reports COLUMN_NOT_FOUND for a column the dataset lacks', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Unknown column',
          aggregate: 'sum',
          columnId: 'missing',
        }),
      ),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test('rejects a numeric-only aggregate over a text column', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Text sum',
          aggregate: 'sum',
          columnId: 'col_notes',
        }),
      ),
    ).toBe('INCOMPATIBLE_COLUMN');
  });

  test('reports FILTER_NOT_FOUND for an unknown filter reference', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Bad filter',
          aggregate: 'count',
          filters: ['missing'],
        }),
      ),
    ).toBe('FILTER_NOT_FOUND');
  });

  test('rejects a filter that belongs to another dataset', () => {
    expect(
      failureCode(
        createMetric(withForeignFilter(workspaceWithFilter()), {
          datasetId: 'ds_sales',
          name: 'Other filter',
          aggregate: 'count',
          filters: ['filter_other'],
        }),
      ),
    ).toBe('INCOMPATIBLE_COLUMN');
  });

  test('reports COLUMN_NOT_FOUND when a running total orders by a missing column', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Running bad',
          aggregate: 'sum',
          columnId: NUMERIC_COLUMN,
          modifier: { kind: 'runningTotal', orderBy: 'missing' },
        }),
      ),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test('reports COLUMN_NOT_FOUND when a time comparison names a missing date column', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Time missing',
          aggregate: 'sum',
          columnId: NUMERIC_COLUMN,
          modifier: { kind: 'timeComparison', dateColumnId: 'missing', unit: 'month', offset: 1, as: 'difference' },
        }),
      ),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test('rejects a time comparison anchored to a non-temporal column', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Time wrong type',
          aggregate: 'sum',
          columnId: NUMERIC_COLUMN,
          modifier: { kind: 'timeComparison', dateColumnId: 'col_region', unit: 'month', offset: 1, as: 'difference' },
        }),
      ),
    ).toBe('INCOMPATIBLE_COLUMN');
  });

  test('rejects a time comparison offset outside the supported range', () => {
    expect(
      failureCode(
        createMetric(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: 'Time bad offset',
          aggregate: 'sum',
          columnId: NUMERIC_COLUMN,
          modifier: { kind: 'timeComparison', dateColumnId: DATE_COLUMN, unit: 'month', offset: 0, as: 'difference' },
        }),
      ),
    ).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('stores a row-count metric under its trimmed name', () => {
    const { workspace, metricId } = workspaceWithCountMetric();

    expect(workspace.metrics[metricId]?.name).toBe('Rows');
    expect(workspace.metrics[metricId]?.aggregate).toBe('count');
    expect(workspace.metrics[metricId]?.columnId).toBeUndefined();
  });

  test('keeps a same-dataset filter reference on the metric', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(workspace.metrics[metricId]?.filters).toEqual([SALES_FILTER.id]);
  });

  test('defaults a percent-of-total metric to percent formatting', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(workspace.metrics[metricId]?.format?.style).toBe('percent');
  });

  test('defaults a percent-change time comparison to percent formatting', () => {
    const modifier: MetricModifier = {
      kind: 'timeComparison',
      dateColumnId: DATE_COLUMN,
      unit: 'month',
      offset: 1,
      as: 'percentChange',
    };
    const created = createMetric(workspaceWithDataset(), {
      datasetId: 'ds_sales',
      name: 'Change',
      aggregate: 'sum',
      columnId: NUMERIC_COLUMN,
      modifier,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(created.value.workspace.metrics[created.value.changedEntityIds[0]!]?.format?.style).toBe('percent');
  });

  test('accepts a running total ordered by an existing column', () => {
    const created = createMetric(workspaceWithDataset(), {
      datasetId: 'ds_sales',
      name: 'Running',
      aggregate: 'sum',
      columnId: NUMERIC_COLUMN,
      modifier: { kind: 'runningTotal', orderBy: DATE_COLUMN },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(created.value.workspace.metrics[created.value.changedEntityIds[0]!]?.modifier).toEqual({
      kind: 'runningTotal',
      orderBy: DATE_COLUMN,
    });
  });
});

describe('handleUpdateMetric', () => {
  test('reports UNSUPPORTED_OPERATION for an unknown metric', () => {
    expect(failureCode(updateMetric(workspaceWithDataset(), { metricId: 'missing' }))).toBe('UNSUPPORTED_OPERATION');
  });

  test('reports DATASET_NOT_FOUND without changing a stale metric', () => {
    const { workspace, metricId } = workspaceWithMetric();
    const stale = { ...workspace, datasets: {} };
    const result = updateMetric(stale, { metricId, name: 'Changed' });

    expect(failureCode(result)).toBe('DATASET_NOT_FOUND');
    expect(stale.metrics[metricId]?.name).toBe('Share');
  });

  test('rejects a name that is blank once trimmed', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(failureCode(updateMetric(workspace, { metricId, name: ' ' }))).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects switching to count while also supplying a column', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(failureCode(updateMetric(workspace, { metricId, aggregate: 'count', columnId: NUMERIC_COLUMN }))).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  /*
   * `handleCreateMetric` refuses a count metric that carries a column, so an update that switches to
   * count must not leave the previous aggregate's column behind and break that invariant.
   */
  test('drops the inherited column when the aggregate becomes count', () => {
    const { workspace, metricId } = workspaceWithMetric();
    const result = updateMetric(workspace, { metricId, aggregate: 'count' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.workspace.metrics[metricId];

      expect(updated?.aggregate).toBe('count');
      expect(updated?.columnId).toBeUndefined();
    }
  });

  test('rejects switching a count metric to a column aggregate with no column', () => {
    const { workspace, metricId } = workspaceWithCountMetric();

    expect(failureCode(updateMetric(workspace, { metricId, aggregate: 'sum' }))).toBe('INCOMPATIBLE_COLUMN');
  });

  test('reports COLUMN_NOT_FOUND for a column the dataset lacks', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(failureCode(updateMetric(workspace, { metricId, aggregate: 'sum', columnId: 'missing' }))).toBe(
      'COLUMN_NOT_FOUND',
    );
  });

  test('rejects a numeric-only aggregate over a text column', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(failureCode(updateMetric(workspace, { metricId, aggregate: 'sum', columnId: 'col_notes' }))).toBe(
      'INCOMPATIBLE_COLUMN',
    );
  });

  test('reports FILTER_NOT_FOUND for an unknown filter reference', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(failureCode(updateMetric(workspace, { metricId, filters: ['missing'] }))).toBe('FILTER_NOT_FOUND');
  });

  test('rejects a filter that belongs to another dataset', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(failureCode(updateMetric(withForeignFilter(workspace), { metricId, filters: ['filter_other'] }))).toBe(
      'INCOMPATIBLE_COLUMN',
    );
  });

  test('reports COLUMN_NOT_FOUND when a running total orders by a missing column', () => {
    const { workspace, metricId } = workspaceWithMetric();

    expect(
      failureCode(updateMetric(workspace, { metricId, modifier: { kind: 'runningTotal', orderBy: 'missing' } })),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test('applies the merged name, column, format, and modifier', () => {
    const { workspace, metricId } = workspaceWithMetric();
    const updated = updateMetric(workspace, {
      metricId,
      name: ' Updated ',
      aggregate: 'sum',
      columnId: 'col_units',
      format: { style: 'decimal' },
      modifier: { kind: 'none' },
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }

    const metric = updated.value.workspace.metrics[metricId];

    expect(metric?.name).toBe('Updated');
    expect(metric?.columnId).toBe('col_units');
    expect(metric?.format?.style).toBe('decimal');
    expect(metric?.modifier).toEqual({ kind: 'none' });
  });

  test('switches an existing metric to a row count', () => {
    const { workspace, metricId } = workspaceWithMetric();
    const updated = updateMetric(workspace, { metricId, aggregate: 'count' });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }

    expect(updated.value.workspace.metrics[metricId]?.aggregate).toBe('count');
  });
});

describe('handleRemoveMetric', () => {
  test('reports UNSUPPORTED_OPERATION for an unknown metric', () => {
    const { workspace } = workspaceWithMetric();

    expect(failureCode(removeMetric(workspace, { metricId: 'missing' }))).toBe('UNSUPPORTED_OPERATION');
  });

  test('drops the metric from the workspace', () => {
    const { workspace, metricId } = workspaceWithMetric();
    const removed = removeMetric(workspace, { metricId });

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }

    expect(removed.value.workspace.metrics[metricId]).toBeUndefined();
  });
});
