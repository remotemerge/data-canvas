import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { type ChartChannels, useChartChannels } from '@/ui/canvas/use-chart-channels.ts';

const column = (id: string, logicalType: LogicalType): Column => ({
  id,
  name: id,
  physicalName: id,
  databaseType: logicalType,
  logicalType,
  nullable: false,
});

const sales: Dataset = {
  id: 'sales',
  name: 'sales',
  relationId: 'rel_sales',
  source: { kind: 'csv', fileName: 'sales.csv', byteSize: 0, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 10,
  columns: [column('region', 'string'), column('sales', 'number'), column('ordered_at', 'timestamp')],
  revision: 1,
  importStatus: 'ready',
};

const workspace: Workspace = {
  id: 'ws',
  schemaVersion: 1,
  revision: 1,
  name: 'workspace',
  datasets: { sales },
  derivedColumns: {},
  relationships: {},
  visualizations: {},
  filters: {},
  tableSorts: {},
  selections: {},
  metrics: {},
  annotations: {},
  layout: { columns: 12, items: [] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/*
 * Hooks only run inside a render, and the project has no DOM test environment, so a probe component
 * renders the hook result to static markup and the test reads it back.
 */
const runHook = (
  dataset: Dataset | undefined,
  channels: { kind: VisualizationKind; x: string; y: string; aggregate: AggregateFunction; binCount: number },
): ChartChannels => {
  let captured: ChartChannels | undefined;

  const Probe = (): null => {
    captured = useChartChannels(workspace, dataset, channels);

    return null;
  };

  renderToStaticMarkup(<Probe />);

  if (captured === undefined) {
    throw new Error('hook did not run');
  }

  return captured;
};

const channels = (overrides: Partial<Parameters<typeof runHook>[1]> = {}) => ({
  kind: 'bar' as VisualizationKind,
  x: 'region',
  y: 'sales',
  aggregate: 'sum' as AggregateFunction,
  binCount: 20,
  ...overrides,
});

test('an absent dataset yields no columns and no validation', () => {
  const result = runHook(undefined, channels());

  expect(result.scopedColumns).toEqual([]);
  expect(result.measureColumns).toEqual([]);
  expect(result.dimensionColumns).toEqual([]);
  expect(result.validation).toBeNull();
});

test('columns are scoped to the anchor dataset and split by role', () => {
  const result = runHook(sales, channels());

  expect(result.scopedColumns).toHaveLength(3);
  expect(result.measureColumns.map((item) => item.column.id)).toEqual(['sales']);
  expect(result.binnable.map((item) => item.column.id)).toEqual(['sales', 'ordered_at']);
});

test('a KPI offers no dimension columns', () => {
  expect(runHook(sales, channels({ kind: 'kpi' })).dimensionColumns).toEqual([]);
});

test('selecting a temporal dimension marks it for day bucketing', () => {
  const result = runHook(sales, channels({ x: 'ordered_at' }));

  expect(result.selection.temporalDimension).toBe(true);
  expect(result.binding.binX).toEqual({ kind: 'temporal', unit: 'day' });
});

test('a temporal bin column reports temporalBin for the histogram control', () => {
  expect(runHook(sales, channels({ kind: 'histogram', x: 'ordered_at' })).temporalBin).toBe(true);
  expect(runHook(sales, channels({ kind: 'histogram', x: 'sales' })).temporalBin).toBe(false);
});

test('the selection carries the channels the query builder needs', () => {
  const result = runHook(sales, channels({ aggregate: 'avg', binCount: 12 }));

  expect(result.selection).toMatchObject({ kind: 'bar', x: 'region', y: 'sales', aggregate: 'avg' });
});

test('a valid bar chart validates and produces a matching binding', () => {
  const result = runHook(sales, channels());

  expect(result.validation?.ok).toBe(true);
  expect(result.binding).toEqual({ x: 'region', y: ['sales'] });
});
