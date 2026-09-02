import { describe, expect, test } from 'bun:test';
import { buildAnnotationMarks } from '@/visualization/annotations/annotation-marks.ts';
import { resolveAnnotationAnchor } from '@/visualization/annotations/annotation-anchoring.ts';
import { visualization } from '../application/action-fixtures.ts';
import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';

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

// A grouped result whose first column is a category, matching a bar-style chart.
const categoryResult: ChartResult = {
  columns: [
    { key: 'region', name: 'Region', logicalType: 'category' as const },
    { key: 'revenue', name: 'Revenue', logicalType: 'number' as const },
    { key: 'units', name: 'Units', logicalType: 'number' as const },
  ],
  rows: [
    ['West', 10, 2],
    ['East', 8, 3],
  ],
  rowCount: 2,
  sampled: false,
};

const chart = visualization('viz_chart', 'ds_sales');

const annotationFor = (anchor: Annotation['anchor']): Annotation => ({
  id: `annotation-${String(anchor.kind)}`,
  visualizationId: 'viz_chart',
  text: 'note',
  anchor,
  origin: 'human',
  createdBy: 'human',
});

const overCategory = (overrides: Partial<Visualization> = {}): Visualization => ({
  ...chart,
  query: { ...chart.query, dimensions: ['col_region'] },
  binding: { x: 'col_region' },
  ...overrides,
});

// A result with no dimension column, as an ungrouped aggregate produces.
const measureOnlyResult: ChartResult = {
  ...categoryResult,
  columns: [{ key: 'm0', name: 'm0', logicalType: 'number' as const }],
  rows: [[1]],
};

describe('resolveAnnotationAnchor', () => {
  test('a data anchor naming a query dimension resolves to that column', () => {
    const dateResult: ChartResult = {
      ...categoryResult,
      columns: [{ key: 'col_date', name: 'Date', logicalType: 'date' as const }, ...categoryResult.columns.slice(1)],
    };

    expect(
      resolveAnnotationAnchor(annotationFor({ kind: 'data', dimension: 'col_date', value: 'West' }), chart, dateResult),
    ).not.toBeNull();
  });

  // The chart result may rename a dimension, so the display name is accepted as a fallback.
  test('a data anchor falls back to the result column name when the query has no dimensions', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'data', dimension: 'Revenue', value: 10 }),
        { ...chart, query: { ...chart.query, dimensions: [] } },
        categoryResult,
      ),
    ).not.toBeNull();
  });

  test('a data anchor on a dimension the result does not carry is dropped', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'data', dimension: 'missing', value: 'West' }),
        chart,
        categoryResult,
      ),
    ).toBeNull();
  });

  test('a point anchor resolves when a row holds both coordinates', () => {
    expect(
      resolveAnnotationAnchor(annotationFor({ kind: 'point', x: 'West', y: 10 }), chart, categoryResult),
    ).not.toBeNull();
  });

  test('a point anchor whose x is absent from every row is dropped', () => {
    expect(
      resolveAnnotationAnchor(annotationFor({ kind: 'point', x: 'North', y: 10 }), chart, categoryResult),
    ).toBeNull();
  });

  test('a category anchor pins to the first query dimension', () => {
    expect(
      resolveAnnotationAnchor(annotationFor({ kind: 'category', value: 'West' }), overCategory(), categoryResult),
    ).not.toBeNull();
  });

  // Without query dimensions the first non-measure result column stands in for the category axis.
  test('a category anchor falls back to the first non-measure result column', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'category', value: 'West' }),
        { ...chart, query: { ...chart.query, dimensions: [] }, binding: {} },
        categoryResult,
      ),
    ).not.toBeNull();
  });

  test('a category anchor is dropped when the result has no category column to pin to', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'category', value: 'West' }),
        { ...chart, query: { ...chart.query, dimensions: [] }, binding: {} },
        measureOnlyResult,
      ),
    ).toBeNull();
  });

  test('a range anchor resolves when both endpoints appear in the dimension column', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'range', from: 'West', to: 'East' }),
        overCategory(),
        categoryResult,
      ),
    ).not.toBeNull();
  });

  test('a range anchor missing one endpoint is dropped rather than clamped', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'range', from: 'West', to: 'North' }),
        overCategory(),
        categoryResult,
      ),
    ).toBeNull();
  });

  test('a range anchor needs the bound x column among the query dimensions', () => {
    expect(
      resolveAnnotationAnchor(
        annotationFor({ kind: 'range', from: 'West', to: 'East' }),
        { ...chart, query: { ...chart.query, dimensions: [] }, binding: {} },
        categoryResult,
      ),
    ).toBeNull();
  });
});
