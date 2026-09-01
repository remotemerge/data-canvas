import { describe, expect, test } from 'bun:test';
import { buildEChartsOption, type ChartTheme } from '@/visualization/echarts/build-echarts-option.ts';
import { visualization } from '@/../tests/unit/application/action-fixtures.ts';

const theme: ChartTheme = {
  text: '#fff',
  muted: '#999',
  border: '#333',
  grid: '#222',
  axis: '#444',
  tooltipBackground: '#111',
  tooltipText: '#fff',
  colors: ['#08f'],
};

describe('ECharts option builder', () => {
  test('uses one dataset source with encoded series', () => {
    const option = buildEChartsOption(
      visualization('vis_1', 'ds_sales'),
      {
        columns: [
          { key: 'col_region', name: 'region', logicalType: 'category' },
          { key: 'col_revenue', name: 'revenue', logicalType: 'number' },
        ],
        rows: [['West', 10]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );
    expect(option['dataset']).toEqual({ dimensions: ['region', 'revenue'], source: [['West', 10]] });
    expect(option['backgroundColor']).toBe('transparent');
  });

  test('escapes dataset-derived tooltip text', () => {
    const option = buildEChartsOption(
      visualization('vis_1', 'ds_sales'),
      {
        columns: [
          { key: 'col_region', name: 'region', logicalType: 'category' },
          { key: 'col_revenue', name: 'revenue', logicalType: 'number' },
        ],
        rows: [['<script>alert(1)</script>', 10]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );
    const formatter = (option['tooltip'] as { formatter: (params: unknown) => string }).formatter;
    expect(formatter({ value: '<script>alert(1)</script>' })).not.toContain('<script>');
    expect(formatter({ value: '<script>alert(1)</script>' })).toContain('&lt;script&gt;');
  });

  // The tooltip keeps ECharts' marker markup while formatting each dataset value by column.
  test('labels each value by its column instead of dumping the params object', () => {
    const option = buildEChartsOption(
      visualization('vis_1', 'ds_sales'),
      {
        columns: [
          { key: 'col_region', name: 'region', logicalType: 'category' },
          { key: 'col_revenue', name: 'revenue', logicalType: 'number' },
        ],
        rows: [['West', 1234.5]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );
    const formatter = (option['tooltip'] as { formatter: (params: unknown) => string }).formatter;
    const rendered = formatter({
      marker: '<span style="background-color:#3b82f6"></span>',
      seriesName: 'revenue',
      value: ['West', 1234.5],
      dimensionNames: ['region', 'revenue'],
    });

    expect(rendered).toContain('region: West');
    expect(rendered).toContain('revenue: 1,234.5');
    // The swatch is ECharts' own markup and stays live rather than being shown as text.
    expect(rendered).toContain('<span style="background-color:#3b82f6"></span>');
    expect(rendered).not.toContain('dimensionNames');
    expect(rendered).not.toContain('&lt;span');
  });

  // A single-series legend adds no useful encoding and may expose an aggregate label such as `sum`.
  test('hides the legend when there is only one series', () => {
    const option = buildEChartsOption(
      visualization('vis_1', 'ds_sales'),
      {
        columns: [
          { key: 'col_date', name: 'date', logicalType: 'date' },
          { key: 'col_revenue', name: 'sum', logicalType: 'number' },
        ],
        rows: [['2024-01-01', 10]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );

    expect((option['legend'] as { show: boolean }).show).toBe(false);
  });

  test('shows the legend once a second series makes it meaningful', () => {
    const multi = visualization('vis_1', 'ds_sales');
    const option = buildEChartsOption(
      {
        ...multi,
        binding: { ...multi.binding, y: ['col_revenue', 'col_profit'] },
        query: {
          ...multi.query,
          measures: [
            { columnId: 'col_revenue', aggregate: 'sum' },
            { columnId: 'col_profit', aggregate: 'sum' },
          ],
        },
      },
      {
        columns: [
          { key: 'col_date', name: 'date', logicalType: 'date' },
          { key: 'col_revenue', name: 'revenue', logicalType: 'number' },
          { key: 'col_profit', name: 'profit', logicalType: 'number' },
        ],
        rows: [['2024-01-01', 10, 4]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );

    expect((option['legend'] as { show: boolean }).show).toBe(true);
  });

  test('the user turning the legend off still wins over a multi-series chart', () => {
    const multi = visualization('vis_1', 'ds_sales');
    const option = buildEChartsOption(
      {
        ...multi,
        presentation: { ...multi.presentation, showLegend: false },
        binding: { ...multi.binding, y: ['col_revenue', 'col_profit'] },
        query: {
          ...multi.query,
          measures: [
            { columnId: 'col_revenue', aggregate: 'sum' },
            { columnId: 'col_profit', aggregate: 'sum' },
          ],
        },
      },
      {
        columns: [
          { key: 'col_date', name: 'date', logicalType: 'date' },
          { key: 'col_revenue', name: 'revenue', logicalType: 'number' },
          { key: 'col_profit', name: 'profit', logicalType: 'number' },
        ],
        rows: [['2024-01-01', 10, 4]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );

    expect((option['legend'] as { show: boolean }).show).toBe(false);
  });

  // Count binned dimensions when determining how many measures remain for the chart.
  test('a binned dimension is not mistaken for a measure', () => {
    const base = visualization('vis_1', 'ds_sales');
    const option = buildEChartsOption(
      {
        ...base,
        binding: { ...base.binding, binX: { kind: 'temporal', unit: 'week' } },
        query: {
          ...base.query,
          dimensions: [],
          binnedDimensions: [{ columnId: 'col_date', strategy: { kind: 'temporal', unit: 'week' } }],
        },
      },
      {
        columns: [
          { key: 'col_date', name: 'Order Date', logicalType: 'date' },
          { key: 'm0', name: 'sum', logicalType: 'number' },
        ],
        rows: [['2024-01-01', 10]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );

    expect(option['series']).toHaveLength(1);
    expect((option['legend'] as { show: boolean }).show).toBe(false);
  });

  test('a positional series without a row still renders its value', () => {
    const option = buildEChartsOption(
      visualization('vis_1', 'ds_sales'),
      {
        columns: [
          { key: 'col_region', name: 'region', logicalType: 'category' },
          { key: 'col_revenue', name: 'revenue', logicalType: 'number' },
        ],
        rows: [['West', 10]],
        rowCount: 1,
        sampled: false,
      },
      theme,
    );
    const formatter = (option['tooltip'] as { formatter: (params: unknown) => string }).formatter;

    expect(formatter({ marker: '', seriesName: 'revenue', value: 10 })).toContain('10');
  });
});
