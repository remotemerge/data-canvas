import { expect, test } from 'bun:test';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import {
  binnableColumns,
  buildBinding,
  buildQuery,
  type ChannelSelection,
  clampBinCount,
  numericColumns,
  groupByDataset,
  resolveBinStrategy,
  type ScopedColumn,
} from '@/ui/canvas/visualization-form.ts';

const column = (id: string, logicalType: LogicalType): Column => ({
  id,
  name: id,
  physicalName: id,
  databaseType: logicalType,
  logicalType,
  nullable: false,
});

const dataset = (id: string, columns: Column[]): Dataset => ({
  id,
  name: id,
  relationId: `rel_${id}`,
  source: { kind: 'csv', fileName: `${id}.csv`, byteSize: 0, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 0,
  columns,
  revision: 1,
  importStatus: 'ready',
});

const scoped = (source: Dataset): ScopedColumn[] => source.columns.map((item) => ({ column: item, dataset: source }));

const selection = (overrides: Partial<ChannelSelection> = {}): ChannelSelection => ({
  kind: 'bar',
  x: 'region',
  y: 'sales',
  aggregate: 'sum',
  binStrategy: { kind: 'equalWidth', binCount: 20 },
  temporalDimension: false,
  ...overrides,
});

const sales = dataset('sales', [
  column('region', 'string'),
  column('sales', 'number'),
  column('ordered_at', 'timestamp'),
]);

test('groups columns by dataset while preserving caller order', () => {
  const other = dataset('returns', [column('reason', 'string')]);
  const groups = groupByDataset([...scoped(sales), ...scoped(other), ...scoped(sales).slice(0, 1)]);

  expect(groups.map((group) => group.dataset.id)).toEqual(['sales', 'returns']);
  // A repeat of an earlier dataset joins that dataset's existing group rather than opening a new one.
  expect(groups[0]?.columns).toHaveLength(4);
});

test('offers only numeric columns as measures and numeric or temporal as binnable', () => {
  expect(numericColumns(scoped(sales)).map((item) => item.column.id)).toEqual(['sales']);
  expect(binnableColumns(scoped(sales)).map((item) => item.column.id)).toEqual(['sales', 'ordered_at']);
});

test('bins a temporal column by month and a numeric column by bucket count', () => {
  const binnable = binnableColumns(scoped(sales));

  expect(resolveBinStrategy(binnable, 'ordered_at', 20)).toEqual({ kind: 'temporal', unit: 'month' });
  expect(resolveBinStrategy(binnable, 'sales', 12)).toEqual({ kind: 'equalWidth', binCount: 12 });
  // An unselected column falls back to the numeric shape.
  expect(resolveBinStrategy(binnable, '', 7)).toEqual({ kind: 'equalWidth', binCount: 7 });
});

test('typed bucket counts are clamped to the bounds that cap result sizes', () => {
  expect(clampBinCount('25')).toBe(25);
  expect(clampBinCount('1')).toBe(2);
  expect(clampBinCount('1000')).toBe(100);
  // Fractions truncate, and unparseable or zero input falls back to the minimum rather than NaN.
  expect(clampBinCount('7.9')).toBe(7);
  expect(clampBinCount('')).toBe(2);
  expect(clampBinCount('abc')).toBe(2);
  expect(clampBinCount('0')).toBe(2);
  expect(clampBinCount('-5')).toBe(2);
});

test('a KPI binds only a measure and a histogram binds only a binned dimension', () => {
  expect(buildBinding(selection({ kind: 'kpi' }))).toEqual({ y: ['sales'] });
  expect(buildBinding(selection({ kind: 'kpi', y: '' }))).toEqual({ y: [] });

  expect(buildBinding(selection({ kind: 'histogram' }))).toEqual({
    x: 'region',
    binX: { kind: 'equalWidth', binCount: 20 },
  });
  expect(buildBinding(selection({ kind: 'histogram', x: '' }))).toEqual({});
});

test('a temporal dimension is bucketed by day in the binding', () => {
  expect(buildBinding(selection({ temporalDimension: true }))).toEqual({
    x: 'region',
    y: ['sales'],
    binX: { kind: 'temporal', unit: 'day' },
  });
});

test('unselected channels are omitted from the binding', () => {
  expect(buildBinding(selection({ x: '', y: '' }))).toEqual({});
});

test('a histogram counts rows over a binned dimension', () => {
  expect(buildQuery('sales', selection({ kind: 'histogram' }))).toEqual({
    datasetId: 'sales',
    dimensions: [],
    binnedDimensions: [{ columnId: 'region', strategy: { kind: 'equalWidth', binCount: 20 } }],
    measures: [{ aggregate: 'count' }],
    filters: [],
  });
});

test('a boxplot requests a distribution split by the category column', () => {
  expect(buildQuery('sales', selection({ kind: 'boxplot' }))).toMatchObject({
    datasetId: 'sales',
    dimensions: [],
    measures: [],
    distribution: { columnId: 'sales', categoryColumnId: 'region' },
    filters: [],
  });

  // Without a measure there is no distribution to compute.
  expect(buildQuery('sales', selection({ kind: 'boxplot', y: '' }))).toEqual({
    datasetId: 'sales',
    dimensions: [],
    measures: [],
    filters: [],
  });
});

test('a scatter plot keeps both channels as dimensions so rows are not aggregated', () => {
  expect(buildQuery('sales', selection({ kind: 'scatter' }))).toEqual({
    datasetId: 'sales',
    dimensions: ['region', 'sales'],
    measures: [],
    filters: [],
  });
});

test('a grouped query aggregates the measure per dimension', () => {
  expect(buildQuery('sales', selection({ aggregate: 'avg' }))).toEqual({
    datasetId: 'sales',
    dimensions: ['region'],
    measures: [{ columnId: 'sales', aggregate: 'avg' }],
    filters: [],
  });
});

test('a temporal dimension moves from dimensions to binnedDimensions', () => {
  expect(buildQuery('sales', selection({ x: 'ordered_at', temporalDimension: true }))).toEqual({
    datasetId: 'sales',
    dimensions: [],
    binnedDimensions: [{ columnId: 'ordered_at', strategy: { kind: 'temporal', unit: 'day' } }],
    measures: [{ columnId: 'sales', aggregate: 'sum' }],
    filters: [],
  });
});
