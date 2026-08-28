import { describe, expect, test } from 'bun:test';
import { categorySelectionFromClick, rangeSelection } from '@/visualization/interaction/chart-events.ts';
import { visualization } from '@/../tests/unit/application/action-fixtures.ts';

describe('chart events', () => {
  test('turns a category click into a predicate', () => {
    const chart = visualization('vis_1', 'ds_sales');
    expect(categorySelectionFromClick(chart, { data: ['West', 10] })).toEqual({
      kind: 'comparison',
      columnId: 'col_date',
      operator: 'eq',
      value: 'West',
    });
  });

  test('normalizes brushed numeric ranges', () => {
    expect(rangeSelection('col_revenue', 10, 2)).toEqual({
      kind: 'comparison',
      columnId: 'col_revenue',
      operator: 'between',
      value: [2, 10],
    });
  });
});
