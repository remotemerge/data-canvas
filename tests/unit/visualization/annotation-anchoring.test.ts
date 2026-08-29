import { describe, expect, test } from 'bun:test';
import { buildAnnotationMarks } from '@/visualization/annotations/annotation-marks.ts';
import { visualization } from '../application/action-fixtures.ts';
import type { ChartResult } from '@/application/queries/visualization-query.ts';

const result: ChartResult = {
  columns: [
    { key: 'order_date', name: 'order_date', logicalType: 'date' as const },
    { key: 'revenue', name: 'revenue', logicalType: 'number' as const },
  ],
  rows: [
    ['2026-01-01', 10],
    ['2026-02-01', 20],
  ],
  rowCount: 2,
  sampled: false,
};
const base = { visualizationId: 'viz_1', origin: 'human' as const, createdBy: 'human' as const };

describe('annotation marks', () => {
  test('maps data, point, and range anchors and hides unresolved anchors', () => {
    const marks = buildAnnotationMarks(
      [
        {
          ...base,
          id: 'ann_data',
          text: '<b>plain</b>',
          anchor: { kind: 'data', dimension: 'col_date', value: '2026-01-01' },
        },
        { ...base, id: 'ann_point', text: 'point', anchor: { kind: 'point', x: '2026-02-01', y: 20 } },
        { ...base, id: 'ann_range', text: 'range', anchor: { kind: 'range', from: '2026-01-01', to: '2026-02-01' } },
        { ...base, id: 'ann_hidden', text: 'missing', anchor: { kind: 'point', x: 'missing', y: 99 } },
      ],
      visualization('viz_1', 'ds_sales'),
      result,
    );
    expect(marks.markLine?.data).toHaveLength(1);
    expect(marks.markPoint?.data).toHaveLength(1);
    expect(marks.markArea?.data).toHaveLength(1);
    expect(JSON.stringify(marks)).toContain('<b>plain</b>');
  });
});
