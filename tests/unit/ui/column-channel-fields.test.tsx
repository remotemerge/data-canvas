import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';
import { AggregateField, DimensionField, MeasureField, SeriesField } from '@/ui/canvas/column-channel-fields.tsx';
import type { ScopedColumn } from '@/ui/canvas/visualization-form.ts';

const column = (id: string, logicalType: LogicalType): Column => ({
  id,
  name: `${id} label`,
  physicalName: id,
  databaseType: logicalType,
  logicalType,
  nullable: false,
});

const dataset = (id: string, columns: Column[]): Dataset => ({
  id,
  name: `${id} dataset`,
  relationId: `rel_${id}`,
  source: { kind: 'csv', fileName: `${id}.csv`, byteSize: 0, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 0,
  columns,
  revision: 1,
  importStatus: 'ready',
});

const sales = dataset('sales', [column('region', 'string'), column('sales', 'number')]);
const columns: ScopedColumn[] = sales.columns.map((item) => ({ column: item, dataset: sales }));

const dimensionField = (kind: VisualizationKind, temporalBin = false): string =>
  renderToStaticMarkup(
    <DimensionField
      kind={kind}
      x=""
      onXChange={() => undefined}
      binnable={columns}
      dimensionColumns={columns}
      temporalBin={temporalBin}
      binCount={20}
      onBinCountChange={() => undefined}
    />,
  );

const aggregateField = (kind: VisualizationKind): string =>
  renderToStaticMarkup(<AggregateField kind={kind} aggregate="sum" onAggregateChange={() => undefined} />);

const seriesField = (kind: VisualizationKind, scoped: ScopedColumn[] = columns): string =>
  renderToStaticMarkup(<SeriesField kind={kind} series="" onSeriesChange={() => undefined} columns={scoped} />);

test('a KPI offers no dimension, measure stays available', () => {
  expect(dimensionField('kpi')).toBe('');
  expect(
    renderToStaticMarkup(<MeasureField kind="kpi" y="" onYChange={() => undefined} columns={columns} />),
  ).toContain('Measure');
});

test('a histogram offers a bin column and a bucket count', () => {
  const markup = dimensionField('histogram');

  expect(markup).toContain('Column to bin');
  expect(markup).toContain('Buckets');
  expect(markup).toContain('type="number"');
});

test('a temporal bin column replaces the bucket count with an explanation', () => {
  const markup = dimensionField('histogram', true);

  expect(markup).toContain('grouped by month');
  expect(markup).not.toContain('type="number"');
});

test('other kinds offer a plain dimension picker grouped by dataset', () => {
  const markup = dimensionField('bar');

  expect(markup).toContain('Dimension');
  expect(markup).toContain('<optgroup label="sales dataset">');
  expect(markup).toContain('region label');
});

test('a histogram has no measure selector because its measure is the bucket count', () => {
  expect(
    renderToStaticMarkup(<MeasureField kind="histogram" y="" onYChange={() => undefined} columns={columns} />),
  ).toBe('');
});

test('histograms and boxplots have no aggregate selector', () => {
  expect(aggregateField('histogram')).toBe('');
  expect(aggregateField('boxplot')).toBe('');
  expect(aggregateField('bar')).toContain('Aggregate');
});

/*
 * Only a heatmap grids two dimensions, so only a heatmap offers the second one. Showing the picker
 * elsewhere would present a control whose value the binding discards.
 */
test('only a heatmap offers a series picker', () => {
  expect(seriesField('heatmap')).toContain('Series');
  expect(seriesField('heatmap')).toContain('region label');

  for (const kind of ['bar', 'line', 'area', 'scatter', 'donut', 'kpi', 'histogram', 'boxplot'] as const) {
    expect(seriesField(kind)).toBe('');
  }
});

test('the series picker groups its columns by dataset', () => {
  expect(seriesField('heatmap')).toContain('<optgroup label="sales dataset">');
});

test('column labels render as text, so dataset values cannot inject markup', () => {
  const hostile = dataset('x', [column('<img src=x onerror=alert(1)>', 'number')]);
  const markup = renderToStaticMarkup(
    <MeasureField
      kind="bar"
      y=""
      onYChange={() => undefined}
      columns={hostile.columns.map((item) => ({ column: item, dataset: hostile }))}
    />,
  );

  expect(markup).toContain('&lt;img');
  expect(markup).not.toContain('<img');
});

// The series picker renders imported column names too, so it must escape them like every other field.
test('the series picker escapes hostile column names', () => {
  const hostile = dataset('x', [column('<img src=x onerror=alert(1)>', 'string')]);
  const markup = seriesField(
    'heatmap',
    hostile.columns.map((item) => ({ column: item, dataset: hostile })),
  );

  expect(markup).toContain('&lt;img');
  expect(markup).not.toContain('<img');
});
