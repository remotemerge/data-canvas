import { describe, expect, test } from 'bun:test';
import {
  boundChartRows,
  chartSamplingDecision,
  MAX_CHART_POINTS,
  readableChartPoints,
} from '@/application/queries/sampling-policy.ts';

describe('chart sampling policy', () => {
  test('keeps a bounded result unchanged', () => {
    expect(boundChartRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], sampled: false });
  });

  test('caps plotted points and reports the bound', () => {
    const result = boundChartRows(Array.from({ length: MAX_CHART_POINTS + 1 }, (_, index) => index));
    expect(result.rows).toHaveLength(MAX_CHART_POINTS);
    expect(result.sampled).toBe(true);
  });

  // One row beyond the cap is fetched so the caller can tell a full result from a truncated one.
  test('an absent request limit takes the cap plus the probe row and is not sampled', () => {
    expect(chartSamplingDecision()).toEqual({ limit: MAX_CHART_POINTS + 1, sampled: false });
  });

  test('a request beyond the cap is clamped and reported as sampled', () => {
    expect(chartSamplingDecision(MAX_CHART_POINTS + 1)).toEqual({ limit: MAX_CHART_POINTS + 1, sampled: true });
  });

  test('a request inside the cap is honored as asked', () => {
    expect(chartSamplingDecision(100)).toEqual({ limit: 100, sampled: false });
  });
});

describe('readable point target', () => {
  test('scales with the plot width', () => {
    expect(readableChartPoints(900)).toBe(180);
  });

  test('a narrow plot keeps enough points to show a series shape', () => {
    expect(readableChartPoints(120)).toBe(60);
  });

  test('a very wide plot stops short of packing marks together', () => {
    expect(readableChartPoints(10_000)).toBe(300);
  });

  // The legibility target can request fewer points, never more than the hard cap.
  test('never exceeds the performance budget', () => {
    expect(readableChartPoints(100_000)).toBeLessThan(MAX_CHART_POINTS);
  });
});
