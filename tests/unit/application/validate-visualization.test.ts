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

/** One valid binding per kind, so the table below can assert every kind has a satisfiable rule. */
const validBinding: Record<VisualizationKind, VisualBinding> = {
  line: { x: DATE, y: [REVENUE] },
  area: { x: DATE, y: [REVENUE] },
  bar: { x: REGION, y: [REVENUE] },
  scatter: { x: REVENUE, y: [REVENUE] },
  donut: { x: REGION, y: [REVENUE] },
  kpi: { y: [REVENUE] },
  table: { x: REGION },
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

    expect(check('bar', { x: REGION, y: measures }).ok).toBe(true);
    expect(check('bar', { x: REGION, y: [...measures, REVENUE] }).ok).toBe(false);
  });

  test('measures must be numeric', () => {
    expect(check('bar', { x: REGION, y: [REGION] }).ok).toBe(false);
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

    if (result.ok) return;

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
