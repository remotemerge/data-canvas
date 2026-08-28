import { describe, expect, test } from 'bun:test';
import { boundChartRows, MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';

describe('chart sampling policy', () => {
  test('keeps a bounded result unchanged', () => {
    expect(boundChartRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], sampled: false });
  });

  test('caps plotted points and reports the bound', () => {
    const result = boundChartRows(Array.from({ length: MAX_CHART_POINTS + 1 }, (_, index) => index));
    expect(result.rows).toHaveLength(MAX_CHART_POINTS);
    expect(result.sampled).toBe(true);
  });
});
