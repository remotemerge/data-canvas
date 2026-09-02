import { describe, expect, test } from 'bun:test';
import { MAX_BOUND_MEASURES, validateVisualization } from '@/application/validation/validate-visualization.ts';
import type { VisualBinding, VisualizationKind } from '@/domain/visualization/visualization.ts';
import { VISUALIZATION_KINDS } from '@/domain/visualization/visualization.ts';
import { salesDataset } from './action-fixtures.ts';

const dataset = salesDataset();

const DATE = 'col_date';
const REGION = 'col_region';
const REVENUE = 'col_revenue';

const check = (kind: VisualizationKind, binding: VisualBinding) => validateVisualization(dataset, kind, binding);

// One valid binding per kind, so the table below can assert every kind has a satisfiable rule.
const validBinding: Record<VisualizationKind, VisualBinding> = {
  line: { x: DATE, y: [REVENUE] },
  area: { x: DATE, y: [REVENUE] },
  bar: { x: REGION, y: [REVENUE] },
  scatter: { x: REVENUE, y: [REVENUE] },
  donut: { x: REGION, y: [REVENUE] },
  kpi: { y: [REVENUE] },
  table: { x: REGION },
  histogram: { x: REVENUE, binX: { kind: 'equalWidth', binCount: 20 } },
  boxplot: { x: REGION, y: [REVENUE] },
  heatmap: { x: REGION, series: DATE, y: [REVENUE] },
};

describe('per-kind binding rules', () => {
  test('the fixture table covers every visualization kind', () => {
    expect(Object.keys(validBinding).toSorted()).toEqual([...VISUALIZATION_KINDS].toSorted());
  });

  test.each(VISUALIZATION_KINDS.map((kind) => [kind] as const))('%s accepts its canonical binding', (kind) => {
    expect(check(kind, validBinding[kind]).ok).toBe(true);
  });

  test('line and area require a temporal or ordered numeric x', () => {
    expect(check('line', { x: REGION, y: [REVENUE] }).ok).toBe(false);
    expect(check('area', { x: REGION, y: [REVENUE] }).ok).toBe(false);
    expect(check('line', { x: REVENUE, y: [REVENUE] }).ok).toBe(true);
  });

  test('bar accepts a category x, unlike line and area', () => {
    expect(check('bar', { x: REGION, y: [REVENUE] }).ok).toBe(true);
    expect(check('bar', { x: DATE, y: [REVENUE] }).ok).toBe(true);
  });

  test('series kinds require an x and at least one measure', () => {
    expect(check('line', { y: [REVENUE] }).ok).toBe(false);
    expect(check('line', { x: DATE }).ok).toBe(false);
    expect(check('line', { x: DATE, y: [] }).ok).toBe(false);
  });

  test('series kinds accept multiple measures up to the bound', () => {
    const measures = Array.from({ length: MAX_BOUND_MEASURES }, () => REVENUE);
    const overBound = check('bar', { x: REGION, y: [...measures, REVENUE] });

    expect(check('bar', { x: REGION, y: measures }).ok).toBe(true);
    expect(overBound.ok).toBe(false);
    expect(overBound.ok ? null : overBound.error.code).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('measures must be numeric', () => {
    expect(check('bar', { x: REGION, y: [REGION] }).ok).toBe(false);
  });

  // Both axes carry a value, so a scatter with no x has nothing to plot against.
  test('scatter without an x channel is refused', () => {
    expect(check('scatter', { y: [REVENUE] }).ok).toBe(false);
  });

  test('scatter requires numeric x and exactly one numeric y', () => {
    expect(check('scatter', { x: REGION, y: [REVENUE] }).ok).toBe(false);
    expect(check('scatter', { x: REVENUE, y: [REVENUE, REVENUE] }).ok).toBe(false);
    expect(check('scatter', { x: REVENUE, y: [] }).ok).toBe(false);
    expect(check('scatter', { x: REVENUE }).ok).toBe(false);
  });

  test('donut requires one category dimension and one measure', () => {
    expect(check('donut', { x: REVENUE, y: [REVENUE] }).ok).toBe(false);
    expect(check('donut', { x: REGION, y: [REVENUE, REVENUE] }).ok).toBe(false);
    expect(check('donut', { y: [REVENUE] }).ok).toBe(false);
  });

  test('kpi requires exactly one measure and no dimension', () => {
    expect(check('kpi', { y: [REVENUE, REVENUE] }).ok).toBe(false);
    expect(check('kpi', { y: [] }).ok).toBe(false);
    expect(check('kpi', { x: REGION, y: [REVENUE] }).ok).toBe(false);
    expect(check('kpi', { series: REGION, y: [REVENUE] }).ok).toBe(false);
  });

  test('table requires at least one bound column', () => {
    expect(check('table', {}).ok).toBe(false);
    expect(check('table', { y: [REVENUE] }).ok).toBe(true);
  });

  test('histogram requires an x column to bin', () => {
    expect(check('histogram', {}).ok).toBe(false);
  });

  test('histogram rejects a categorical x, which has no continuous range to divide', () => {
    expect(check('histogram', { x: REGION, binX: { kind: 'equalWidth', binCount: 20 } }).ok).toBe(false);
  });

  test('histogram without a bin strategy is refused as unsupported rather than defaulted', () => {
    const result = check('histogram', { x: REVENUE });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('an out-of-bounds histogram bin strategy surfaces the bin error', () => {
    const result = check('histogram', { x: REVENUE, binX: { kind: 'equalWidth', binCount: 1 } });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('RESULT_LIMIT_EXCEEDED');
  });

  // Both bin channels are validated, so an invalid series strategy is refused like an invalid x one.
  test('an out-of-bounds series bin strategy surfaces the bin error', () => {
    const result = check('heatmap', {
      x: REGION,
      series: REVENUE,
      y: [REVENUE],
      binSeries: { kind: 'equalWidth', binCount: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('RESULT_LIMIT_EXCEEDED');
  });

  // Strategy family and column family must agree, or the compiled bucket expression is nonsense.
  test('histogram pairs numeric strategies with numeric columns and temporal with temporal', () => {
    expect(check('histogram', { x: REVENUE, binX: { kind: 'temporal', unit: 'month' } }).ok).toBe(false);
    expect(check('histogram', { x: DATE, binX: { kind: 'equalWidth', binCount: 20 } }).ok).toBe(false);
    expect(check('histogram', { x: DATE, binX: { kind: 'temporal', unit: 'month' } }).ok).toBe(true);
  });

  test('boxplot requires exactly one numeric measure', () => {
    expect(check('boxplot', {}).ok).toBe(false);
    expect(check('boxplot', { y: ['col_notes'] }).ok).toBe(false);
  });

  // The split column groups the boxes, so a numeric column there would produce one box per value.
  test('boxplot rejects a numeric split column', () => {
    expect(check('boxplot', { x: REVENUE, y: [REVENUE] }).ok).toBe(false);
  });

  test('heatmap requires both axes and one numeric measure', () => {
    expect(check('heatmap', {}).ok).toBe(false);
    expect(check('heatmap', { x: REGION }).ok).toBe(false);
    expect(check('heatmap', { x: REGION, series: DATE, y: [] }).ok).toBe(false);
    expect(check('heatmap', { x: REGION, series: DATE, y: ['col_notes'] }).ok).toBe(false);
  });

  test('a heatmap bin strategy must match its own column family', () => {
    expect(
      check('heatmap', {
        x: REGION,
        series: DATE,
        y: [REVENUE],
        binSeries: { kind: 'equalWidth', binCount: 20 },
      }).ok,
    ).toBe(false);
    expect(
      check('heatmap', { x: REGION, series: DATE, y: [REVENUE], binSeries: { kind: 'temporal', unit: 'month' } }).ok,
    ).toBe(true);
  });

  /*
   * The bin check compares a strategy against a resolved column, so an unresolved one leaves it
   * nothing to judge. Reporting a type mismatch here would mask the real problem, which reference
   * validation reports against the binding itself.
   */
  test('a binned axis naming an unknown column is reported as a missing column', () => {
    const result = check('heatmap', {
      x: REGION,
      series: 'col_missing',
      y: [REVENUE],
      binSeries: { kind: 'temporal', unit: 'month' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    // Reference resolution runs first, so the absent column is named rather than blamed on the bin.
    expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  // Both heatmap axes may be binned, so the x channel is checked against its own column family too.
  test('a heatmap rejects a temporal bin over a category x column', () => {
    const result = check('heatmap', {
      x: REGION,
      series: DATE,
      y: [REVENUE],
      binX: { kind: 'temporal', unit: 'month' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });

  // The kind arrives as unknown from a tool payload, so an unrecognized one is refused explicitly.
  test('an unrecognized visualization kind is refused', () => {
    const result = check('unknown' as VisualizationKind, {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('a dataset with no columns cannot satisfy the table rule', () => {
    const result = validateVisualization({ ...dataset, id: 'ds_empty', columns: [] }, 'table', {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });
});

describe('binding reference resolution', () => {
  test('an unknown column in any channel is rejected with COLUMN_NOT_FOUND', () => {
    for (const binding of [
      { x: 'col_nope', y: [REVENUE] },
      { x: DATE, y: ['col_nope'] },
      { x: DATE, y: [REVENUE], series: 'col_nope' },
      { x: DATE, y: [REVENUE], color: 'col_nope' },
      { x: DATE, y: [REVENUE], size: 'col_nope' },
      { x: DATE, y: [REVENUE], tooltip: ['col_nope'] },
    ] satisfies VisualBinding[]) {
      const result = check('line', binding);

      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });
});

describe('corrective error messages', () => {
  test('a rejection names the offending column and its actual type so an agent can self-correct', () => {
    const result = check('scatter', { x: REGION, y: [REVENUE] });

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
    expect(result.error.message).toContain('scatter');
    expect(result.error.message).toContain('region');
    expect(result.error.message).toContain('category');
  });

  test('a missing channel is named rather than described vaguely', () => {
    const result = check('line', { y: [REVENUE] });

    expect(result.ok ? null : result.error.message).toContain("'x'");
  });
});
