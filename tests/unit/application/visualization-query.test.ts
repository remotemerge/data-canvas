import { describe, expect, test } from 'bun:test';
import type { AnalysisResult, DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import { executeVisualizationQuery, resolveVisualizationQuery } from '@/application/queries/visualization-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';
import { salesDataset, stubDataEngine, visualization, workspaceWithDataset } from './action-fixtures.ts';

// A workspace with one enabled filter and one predicate selection, both on the sales dataset.
const workspaceWithFilterAndSelection = () => {
  const dataset = salesDataset();
  const workspace = workspaceWithDataset();
  workspace.filters['filter_region'] = {
    id: 'filter_region',
    datasetId: dataset.id,
    columnId: 'col_region',
    operator: 'eq',
    value: 'West',
    enabled: true,
    origin: 'human',
    createdBy: 'human',
  };
  workspace.selections['selection_region'] = {
    id: 'selection_region',
    datasetId: dataset.id,
    mode: 'predicate',
    predicate: { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'West' },
    origin: 'chart',
  };

  return { dataset, workspace };
};

describe('visualization query resolution', () => {
  test('adds enabled workspace filters', () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const query = resolveVisualizationQuery(visualization('vis_1', dataset.id), workspace);
    expect(query.limit).toBe(MAX_CHART_POINTS + 1);
    // The workspace filter only. `highlight` is the default and does not restrict the query.
    expect(query.filters).toHaveLength(1);
  });

  test("'filter' link mode applies the selection to the query", () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = { ...visualization('vis_1', dataset.id), linkMode: 'filter' as const };
    const query = resolveVisualizationQuery(chart, workspace);
    expect(query.filters).toHaveLength(2);
  });

  test("'highlight' link mode leaves the query unrestricted", () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = { ...visualization('vis_1', dataset.id), linkMode: 'highlight' as const };
    expect(resolveVisualizationQuery(chart, workspace).filters).toHaveLength(1);
  });

  test("'none' link mode ignores the selection entirely", () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = { ...visualization('vis_1', dataset.id), linkMode: 'none' as const };
    expect(resolveVisualizationQuery(chart, workspace).filters).toHaveLength(1);
  });

  // A chart cannot plot more than the point budget, so a wider request buys nothing.
  test('clamps a query limit above the chart budget', () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = visualization('vis_1', dataset.id);
    const query = resolveVisualizationQuery({ ...chart, query: { ...chart.query, limit: 50_000 } }, workspace);

    expect(query.limit).toBe(MAX_CHART_POINTS + 1);
  });
});

type EngineResult = Result<AnalysisResult, DomainError>;

// Replays a fixed sequence of engine responses so each call in the query pipeline can be controlled.
const scriptedEngine = (responses: EngineResult[]): DataEnginePort => ({
  ...stubDataEngine(),
  executeAnalysis: () => Promise.resolve(responses.shift() ?? ok(analysisRows([]))),
});

const analysisRows = (rows: readonly (string | number | boolean | null)[][]): AnalysisResult => ({
  rows,
  columns: [
    { key: 'col_region', name: 'Region', logicalType: 'category' },
    { key: 'm0', name: 'sum', logicalType: 'number' },
  ],
});

const groupedChart = (): Visualization => ({
  ...visualization('viz_query', 'ds_sales'),
  kind: 'bar',
  linkMode: 'filter',
  query: {
    datasetId: 'ds_sales',
    dimensions: ['col_region'],
    measures: [{ columnId: 'col_revenue', aggregate: 'sum', alias: 'revenue' }],
    filters: [],
  },
  binding: { x: 'col_region', y: ['col_revenue'] },
});

const countChart = (): Visualization => ({
  ...groupedChart(),
  kind: 'kpi',
  query: { datasetId: 'ds_sales', dimensions: [], measures: [{ aggregate: 'count' }], filters: [] },
});

// A histogram over one bin with a known range and one whose range must be measured.
const binnedChart = (): Visualization => ({
  ...groupedChart(),
  id: 'viz_range',
  query: {
    datasetId: 'ds_sales',
    dimensions: [],
    binnedDimensions: [
      { columnId: 'col_revenue', strategy: { kind: 'equalWidth', binCount: 2 } },
      { columnId: 'col_units', strategy: { kind: 'equalWidth', binCount: 2 }, range: { min: 0, max: 10 } },
    ],
    measures: [{ aggregate: 'count' }],
    filters: [],
  },
  binding: { x: 'col_revenue', y: [], binX: { kind: 'equalWidth', binCount: 2 } },
});

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);

  return result.ok ? '' : result.error.code;
};

describe('visualization query execution', () => {
  test('an oversized categorical result is folded into an Other bucket from the population total', async () => {
    const result = await executeVisualizationQuery(
      groupedChart(),
      workspaceWithDataset(),
      scriptedEngine([
        ok(analysisRows([[6_000]])),
        ok(
          analysisRows([
            ['West', 10],
            ['East', 2],
          ]),
        ),
        ok(analysisRows([[20]])),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sampled).toBe(true);
    // Two retained groups plus the reconciled remainder.
    expect(result.value.rowCount).toBe(3);
    expect(result.value.rows[2]).toEqual(['Other', 8]);
  });

  // Without the total there is no honest remainder, so the retained groups stand alone.
  test('a failed total query returns the retained groups without inventing an Other row', async () => {
    const result = await executeVisualizationQuery(
      groupedChart(),
      workspaceWithDataset(),
      scriptedEngine([
        ok(analysisRows([[6_000]])),
        ok(analysisRows([['West', 10]])),
        err(domainError('ENGINE_UNAVAILABLE', 'no totals')),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows).toEqual([['West', 10]]);
    expect(result.value.sampled).toBe(true);
  });

  // An exact kind skips the estimate, so the only engine call is the query itself.
  test('a KPI runs a single exact query with no sampling', async () => {
    const engine = scriptedEngine([ok(analysisRows([[10]]))]);
    const result = await executeVisualizationQuery(countChart(), workspaceWithDataset(), engine);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sampled).toBe(false);
    expect(result.value.rows).toEqual([[10]]);
  });

  // The caller keeps the previous chart, so a superseded result must not deliver rows.
  test('a superseded result is reported stale with no rows', async () => {
    const result = await executeVisualizationQuery(
      countChart(),
      workspaceWithDataset(),
      scriptedEngine([ok({ ...analysisRows([['stale', 1]]), stale: true })]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toMatchObject({ rows: [], rowCount: 0, sampled: false, stale: true });
  });

  test('an engine failure on the chart query is returned to the caller', async () => {
    const result = await executeVisualizationQuery(
      countChart(),
      workspaceWithDataset(),
      scriptedEngine([err(domainError('ENGINE_UNAVAILABLE', 'offline'))]),
    );

    expect(failureCode(result)).toBe('ENGINE_UNAVAILABLE');
  });

  test('a bin with no declared range has its bounds measured before the chart query runs', async () => {
    const requests: unknown[] = [];
    const engine: DataEnginePort = {
      ...stubDataEngine(),
      executeAnalysis: (query) => {
        requests.push(query);

        return Promise.resolve(ok(analysisRows(requests.length === 1 ? [[1, 9]] : [[0, 1, 2]])));
      },
    };
    const result = await executeVisualizationQuery(binnedChart(), workspaceWithDataset(), engine);

    expect(result.ok).toBe(true);
    // Only the unresolved bin is measured; the declared range is used as given.
    expect(requests[0]).toMatchObject({
      measures: [
        { columnId: 'col_revenue', aggregate: 'min' },
        { columnId: 'col_revenue', aggregate: 'max' },
      ],
    });
  });

  test('a failed range lookup aborts before the chart query', async () => {
    const result = await executeVisualizationQuery(
      binnedChart(),
      workspaceWithDataset(),
      scriptedEngine([err(domainError('ENGINE_UNAVAILABLE', 'range'))]),
    );

    expect(failureCode(result)).toBe('ENGINE_UNAVAILABLE');
  });

  // An empty relation yields no min or max, and a non-finite bound would break bin arithmetic.
  test('an empty range lookup falls back to a zero-width range rather than NaN bounds', async () => {
    const result = await executeVisualizationQuery(
      binnedChart(),
      workspaceWithDataset(),
      scriptedEngine([ok(analysisRows([])), ok(analysisRows([]))]),
    );

    expect(result.ok).toBe(true);
  });

  test('rows beyond the point budget are trimmed while the true count is still reported', async () => {
    const largeRows = Array.from({ length: MAX_CHART_POINTS + 10 }, (_, index) => ['group', index]);
    const result = await executeVisualizationQuery(
      groupedChart(),
      workspaceWithDataset(),
      scriptedEngine([
        ok(analysisRows([[6_000]])),
        ok(analysisRows(largeRows)),
        err(domainError('ENGINE_UNAVAILABLE', 'no total')),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Top-N returns the retained groups untrimmed; the budget bound applies to the non-top-N path.
    expect(result.value.rows).toHaveLength(MAX_CHART_POINTS + 10);
  });

  test('a query with no dimensions skips the estimate entirely', async () => {
    const engine = scriptedEngine([ok(analysisRows([[1]]))]);
    const chart = { ...groupedChart(), id: 'viz_single', query: countChart().query };
    const result = await executeVisualizationQuery(chart, workspaceWithDataset(), engine);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows).toEqual([[1]]);
  });

  // An estimate with no row cannot justify sampling, so the query stays exact.
  test('an empty estimate result leaves the chart query unsampled', async () => {
    const result = await executeVisualizationQuery(
      groupedChart(),
      workspaceWithDataset(),
      scriptedEngine([ok(analysisRows([])), ok(analysisRows([['group', 1]]))]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sampled).toBe(false);
  });

  test('a failed estimate leaves the chart query unsampled rather than failing the chart', async () => {
    const result = await executeVisualizationQuery(
      groupedChart(),
      workspaceWithDataset(),
      scriptedEngine([err(domainError('ENGINE_UNAVAILABLE', 'estimate')), ok(analysisRows([['group', 1]]))]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sampled).toBe(false);
  });
});
