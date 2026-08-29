import { describe, expect, test } from 'bun:test';
import { buildEChartsOption } from '@/visualization/echarts/build-echarts-option.ts';
import { visualization } from '@/../tests/unit/application/action-fixtures.ts';

const theme = {
  text: '#fff',
  muted: '#999',
  border: '#333',
  grid: '#222',
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
});
