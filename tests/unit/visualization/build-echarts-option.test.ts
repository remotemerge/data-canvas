import { describe, expect, test } from 'bun:test';
import { buildEChartsOption, type ChartTheme } from '@/visualization/echarts/build-echarts-option.ts';
import { buildAreaSeries } from '@/visualization/echarts/kinds/area.ts';
import { buildBarSeries } from '@/visualization/echarts/kinds/bar.ts';
import { buildBoxplotSeries } from '@/visualization/echarts/kinds/boxplot.ts';
import { buildDonutSeries } from '@/visualization/echarts/kinds/donut.ts';
import { buildHeatmapSeries } from '@/visualization/echarts/kinds/heatmap.ts';
import { buildHistogramSeries } from '@/visualization/echarts/kinds/histogram.ts';
import { buildLineSeries } from '@/visualization/echarts/kinds/line.ts';
import { buildScatterSeries } from '@/visualization/echarts/kinds/scatter.ts';
import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
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

// A grouped category result shared by the temporal-axis, per-kind, and highlight cases.
const categoryResult: ChartResult = {
  columns: [
    { key: 'region', name: 'Region', logicalType: 'category' },
    { key: 'revenue', name: 'Revenue', logicalType: 'number' },
    { key: 'units', name: 'Units', logicalType: 'number' },
  ],
  rows: [
    ['West', 10, 2],
    ['East', 8, 3],
  ],
  rowCount: 2,
  sampled: false,
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

  // Widened time buckets must say which unit is actually drawn, or the axis misleads.
  test('names the x-axis after the widened temporal unit', () => {
    const option = buildEChartsOption(
      visualization('vis_1', 'ds_sales'),
      {
        ...categoryResult,
        disclosure: {
          strategy: { kind: 'temporalWiden', from: 'day', to: 'month' },
          rate: 1,
          estimatedRows: 1000,
        },
      },
      theme,
    );

    expect(option['xAxis']).toMatchObject({ name: 'Monthly' });
  });
});

describe('chart kind series builders', () => {
  test('an area series is a line with a light fill', () => {
    expect(buildAreaSeries(['Revenue', 'Units'], 'Region', false)[0]).toMatchObject({
      type: 'line',
      areaStyle: { opacity: 0.08 },
    });
  });

  test.each([
    ['area', buildAreaSeries],
    ['bar', buildBarSeries],
    ['line', buildLineSeries],
  ] as const)('a stacked %s series shares one stack group', (_kind, build) => {
    expect(build(['Revenue'], 'Region', true)[0]).toMatchObject({ stack: 'total' });
  });

  test('an unstacked bar series leaves its stack group unset', () => {
    expect(buildBarSeries(['Revenue'], 'Region', false)[0]).toMatchObject({ type: 'bar', stack: undefined });
  });

  // Dense lines hide their symbols so the trend stays readable.
  test('a line series hides symbols', () => {
    expect(buildLineSeries(['Revenue'], undefined, false)[0]).toMatchObject({ type: 'line', showSymbol: false });
  });

  test('a scatter series is built per measure', () => {
    expect(buildScatterSeries(['Revenue', 'Units'], 'Region')).toHaveLength(2);
  });

  test('a donut series is a pie with a hollow centre', () => {
    expect(buildDonutSeries('Region', 'Revenue')[0]).toMatchObject({ type: 'pie', radius: ['45%', '70%'] });
  });

  test('histogram bars touch and fall back to a count label without a measure', () => {
    expect(buildHistogramSeries(undefined, 'Bin')[0]).toMatchObject({ name: 'count', barCategoryGap: 0 });
  });

  test('a histogram series takes the measure name when one is bound', () => {
    expect(buildHistogramSeries('Count', undefined)[0]).toMatchObject({ name: 'Count' });
  });

  test('a boxplot with a split offset names each box after its category', () => {
    expect(buildBoxplotSeries([['West', 1, 2, 3, 4, 5]], 1)).toMatchObject({ categories: ['West'] });
  });

  // With no split column every row summarises the whole dataset, so one box is labelled `all`.
  test('an unsplit boxplot labels its single box all', () => {
    expect(buildBoxplotSeries([[1, 2, 3, 4, 5]], 0)).toMatchObject({ categories: ['all'] });
  });

  test('a heatmap derives its colour bounds from the cell values, treating null as zero', () => {
    expect(
      buildHeatmapSeries([
        ['West', 'Jan', 4],
        ['East', 'Feb', null],
      ]),
    ).toMatchObject({ min: 0, max: 4 });
  });

  test('an empty heatmap uses zero bounds rather than an infinite range', () => {
    expect(buildHeatmapSeries([])).toMatchObject({ xCategories: [], yCategories: [], min: 0, max: 0 });
  });
});

const boxplotResult: ChartResult = {
  ...categoryResult,
  columns: [
    { key: 'region', name: 'Region', logicalType: 'category' },
    { key: 'q0', name: 'q0', logicalType: 'number' },
    { key: 'q1', name: 'q1', logicalType: 'number' },
    { key: 'q2', name: 'q2', logicalType: 'number' },
    { key: 'q3', name: 'q3', logicalType: 'number' },
    { key: 'q4', name: 'q4', logicalType: 'number' },
  ],
  rows: [['West', 1, 2, 3, 4, 5]],
};

const heatmapResult: ChartResult = {
  ...categoryResult,
  columns: [
    { key: 'x', name: 'X', logicalType: 'category' },
    { key: 'y', name: 'Y', logicalType: 'category' },
    { key: 'value', name: 'Value', logicalType: 'number' },
  ],
  rows: [['West', 'Jan', 4]],
};

const OPTION_KINDS = ['line', 'bar', 'area', 'scatter', 'donut', 'histogram', 'boxplot', 'heatmap'] as const;

// Each kind pairs a binding and query shape with the result its compiled query would return.
const chartFor = (kind: (typeof OPTION_KINDS)[number]): { visualization: Visualization; result: ChartResult } => {
  const base = visualization('viz_chart', 'ds_sales');

  if (kind === 'histogram') {
    return {
      visualization: {
        ...base,
        kind,
        binding: { x: 'col_revenue', binX: { kind: 'equalWidth', binCount: 4 } },
        query: {
          ...base.query,
          dimensions: [],
          binnedDimensions: [{ columnId: 'col_revenue', strategy: { kind: 'equalWidth', binCount: 4 } }],
          measures: [{ aggregate: 'count' }],
        },
      },
      result: categoryResult,
    };
  }

  if (kind === 'boxplot') {
    return {
      visualization: {
        ...base,
        kind,
        binding: { x: 'col_region', y: ['col_revenue', 'col_units'] },
        query: { ...base.query, dimensions: ['col_region'], measures: [] },
      },
      result: boxplotResult,
    };
  }

  const query = {
    ...base.query,
    dimensions: ['col_region'],
    measures: [
      { columnId: 'col_revenue', aggregate: 'sum' as const },
      { columnId: 'col_units', aggregate: 'sum' as const },
    ],
  };

  if (kind === 'heatmap') {
    return {
      visualization: { ...base, kind, binding: { x: 'col_region', series: 'col_date', y: ['col_revenue'] }, query },
      result: heatmapResult,
    };
  }

  return {
    visualization: { ...base, kind, binding: { x: 'col_region', y: ['col_revenue', 'col_units'] }, query },
    result: categoryResult,
  };
};

const categoryAnnotation: Annotation = {
  id: 'annotation-category',
  visualizationId: 'viz_chart',
  text: 'note',
  anchor: { kind: 'category', value: 'West' },
  origin: 'human',
  createdBy: 'human',
};

describe('per-kind option assembly', () => {
  test.each(OPTION_KINDS.map((kind) => [kind] as const))(
    'a %s chart escapes dataset-derived text in its tooltip',
    (kind) => {
      const chart = chartFor(kind);
      const option = buildEChartsOption(chart.visualization, chart.result, theme, [categoryAnnotation], () => true);
      const formatter = (option['tooltip'] as { formatter: (params: unknown) => string }).formatter;

      expect(formatter({ marker: '*', seriesName: '<unsafe>', value: ['West', '<x>'] })).toContain('&lt;unsafe&gt;');
    },
  );

  test.each(OPTION_KINDS.map((kind) => [kind] as const))(
    'a %s chart tooltip renders a scalar value from a positional series',
    (kind) => {
      const chart = chartFor(kind);
      const option = buildEChartsOption(chart.visualization, chart.result, theme, [categoryAnnotation], () => true);
      const formatter = (option['tooltip'] as { formatter: (params: unknown) => string }).formatter;

      expect(formatter({ name: 'scalar', value: 3 })).toContain('3');
    },
  );
});

describe('selection highlighting', () => {
  // Selected marks keep their palette colour while the rest drop to the muted colour.
  test('the item colour function separates selected marks from unselected ones', () => {
    const highlighted = buildEChartsOption(
      visualization('viz_chart', 'ds_sales'),
      categoryResult,
      theme,
      [],
      (index) => index === 0,
    );
    const series = Array.isArray(highlighted['series'])
      ? (highlighted['series'][0] as {
          itemStyle?: { color?: (params: { dataIndex: number; seriesIndex: number }) => string };
        })
      : undefined;

    expect(series?.itemStyle?.color?.({ dataIndex: 0, seriesIndex: 0 })).toBe('#08f');
    expect(series?.itemStyle?.color?.({ dataIndex: 1, seriesIndex: 1 })).toBe('#999');
  });

  test('without a highlight predicate no item colour override is added', () => {
    const plain = buildEChartsOption(visualization('viz_chart', 'ds_sales'), categoryResult, theme);
    const series = Array.isArray(plain['series']) ? (plain['series'][0] as { itemStyle?: unknown }) : undefined;

    expect(series?.itemStyle).toBeUndefined();
  });
});
