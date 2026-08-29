import { describe, expect, test } from 'bun:test';
import { compileMetricModifier } from '@/data/compiler/compile-metric-modifier.ts';
import { compileTimeSpine } from '@/data/compiler/compile-time-spine.ts';
import { unqualifiedColumnReference } from '@/data/compiler/compile-filter-expression.ts';
import { MAX_TIME_COMPARISON_OFFSET } from '@/domain/metric/metric-modifier.ts';
import { SALES_COLUMNS } from '../application/action-fixtures.ts';

const resolve = unqualifiedColumnReference(SALES_COLUMNS);
const AGGREGATE = 'SUM("revenue")';

describe('metric modifier compilation', () => {
  test('an absent modifier leaves the aggregate untouched', () => {
    const result = compileMetricModifier(undefined, AGGREGATE, resolve);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sql).toBe(AGGREGATE);
  });

  test("'none' is the same as absent, so an explicit default costs nothing", () => {
    const result = compileMetricModifier({ kind: 'none' }, AGGREGATE, resolve);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sql).toBe(AGGREGATE);
  });

  test('percentOfTotal divides by the grand total over an empty window', () => {
    const result = compileMetricModifier({ kind: 'percentOfTotal' }, AGGREGATE, resolve);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('(SUM("revenue") / NULLIF(SUM(SUM("revenue")) OVER (), 0))');
      // An all-zero result must not fail the statement.
      expect(result.value.sql).toContain('NULLIF');
    }
  });

  test('runningTotal accumulates in order with an explicit frame', () => {
    const result = compileMetricModifier({ kind: 'runningTotal', orderBy: 'col_date' }, AGGREGATE, resolve);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe(
        'SUM(SUM("revenue")) OVER (ORDER BY "order_date" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)',
      );
    }
  });

  test('runningTotal over an unknown column is refused', () => {
    const result = compileMetricModifier({ kind: 'runningTotal', orderBy: 'col_missing' }, AGGREGATE, resolve);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  test('timeComparison is not compilable in isolation, since it rewrites the whole statement', () => {
    const result = compileMetricModifier(
      { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset: 1, as: 'percentChange' },
      AGGREGATE,
      resolve,
    );

    expect(result.ok).toBe(false);
  });
});

describe('time comparison spine', () => {
  const spine = (overrides: Partial<Parameters<typeof compileTimeSpine>[0]> = {}) =>
    compileTimeSpine({
      modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset: 1, as: 'percentChange' },
      aggregate: AGGREGATE,
      from: '"dataset_0001"',
      where: '',
      whereParameters: [],
      resolve,
      limit: 100,
      ...overrides,
    });

  test('the axis is generated rather than taken from the rows, so an empty period still exists', () => {
    const result = spine();

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Without the spine, LAG would step back one row and a missing month would shift the
      // comparison onto the wrong period.
      expect(result.value.sql).toContain('generate_series');
      expect(result.value.sql).toContain('LEFT JOIN');
      expect(result.value.sql).toContain('COALESCE(bucketed.value, 0)');
    }
  });

  test('the lag offset and the truncation unit are bound, not interpolated', () => {
    const result = spine({
      modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'quarter', offset: 4, as: 'difference' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.parameters).toEqual(['quarter', 4]);
  });

  test('percentChange divides through NULLIF, which a gap-filled zero makes routine', () => {
    const result = spine();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sql).toContain('NULLIF');
  });

  test('each output shape produces a different comparison column', () => {
    const absolute = spine({
      modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset: 1, as: 'absolute' },
    });
    const difference = spine({
      modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset: 1, as: 'difference' },
    });

    expect(absolute.ok && difference.ok).toBe(true);
    if (absolute.ok && difference.ok) expect(absolute.value.sql).not.toBe(difference.value.sql);
  });

  test('filter parameters bind between the unit and the offset, matching their place in the statement', () => {
    const result = spine({ where: '("revenue" > ?)', whereParameters: [100] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parameters).toEqual(['month', 100, 1]);
      expect(result.value.sql).toContain('WHERE ("revenue" > ?)');
    }
  });

  test('an out-of-range offset is refused before it can grow the spine', () => {
    for (const offset of [0, -1, 1.5, MAX_TIME_COMPARISON_OFFSET + 1]) {
      const result = spine({
        modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset, as: 'absolute' },
      });

      expect(result.ok).toBe(false);
    }
  });

  test('a comparison against a column that does not exist is refused', () => {
    const result = spine({
      modifier: { kind: 'timeComparison', dateColumnId: 'col_missing', unit: 'month', offset: 1, as: 'absolute' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });
});
