import { describe, expect, test } from 'bun:test';
import { compileBinStrategy } from '@/data/compiler/compile-bin-strategy.ts';
import { MAX_BIN_COUNT } from '@/domain/analysis/bin-strategy.ts';

const REFERENCE = '"revenue"';

describe('bin strategy compilation', () => {
  test('equalWidth divides the range into the requested buckets and binds every boundary', () => {
    const result = compileBinStrategy({ kind: 'equalWidth', binCount: 4 }, REFERENCE, { min: 0, max: 100 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('(FLOOR(("revenue" - ?) / ?) * ? + ?)');
      // width = (100 - 0) / 4
      expect(result.value.parameters).toEqual([0, 25, 25, 0]);
    }
  });

  test('the emitted bucket is the lower bound, so a chart axis reads in the column own units', () => {
    const result = compileBinStrategy({ kind: 'equalWidth', binCount: 2 }, REFERENCE, { min: 10, max: 30 });

    expect(result.ok).toBe(true);
    // min + floor((x - min) / width) * width places a value back on the bucket's floor.
    if (result.ok) {
      expect(result.value.parameters).toEqual([10, 10, 10, 10]);
    }
  });

  test('a constant column collapses to one bucket rather than dividing by zero', () => {
    const result = compileBinStrategy({ kind: 'equalWidth', binCount: 10 }, REFERENCE, { min: 5, max: 5 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('?');
      expect(result.value.parameters).toEqual([5]);
    }
  });

  test('equalWidth without a range is refused, since the boundaries are unknowable', () => {
    const result = compileBinStrategy({ kind: 'equalWidth', binCount: 4 }, REFERENCE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
    }
  });

  // Both range-dependent strategies need the column's bounds; neither may guess them.
  test('equalWidthOf without a range is refused', () => {
    const result = compileBinStrategy({ kind: 'equalWidthOf', width: 10 }, REFERENCE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
    }
  });

  test('equalWidthOf rejects a width that would exceed the bucket cap over this range', () => {
    const withinCap = compileBinStrategy({ kind: 'equalWidthOf', width: 10 }, REFERENCE, { min: 0, max: 100 });

    expect(withinCap.ok).toBe(true);

    const overCap = compileBinStrategy({ kind: 'equalWidthOf', width: 1 }, REFERENCE, {
      min: 0,
      max: MAX_BIN_COUNT * 10,
    });

    expect(overCap.ok).toBe(false);
    if (!overCap.ok) {
      expect(overCap.error.code).toBe('RESULT_LIMIT_EXCEEDED');
    }
  });

  test('quantile compiles to ntile, whose bucket is an ordinal rather than a value', () => {
    const result = compileBinStrategy({ kind: 'quantile', quantiles: 4 }, REFERENCE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('NTILE(?) OVER (ORDER BY "revenue")');
      expect(result.value.parameters).toEqual([4]);
    }
  });

  test('explicit breaks emit one arm each with every boundary bound', () => {
    const result = compileBinStrategy({ kind: 'explicit', breaks: [10, 20] }, REFERENCE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('CASE WHEN "revenue" < ? THEN ? WHEN "revenue" < ? THEN ? ELSE ? END');
      expect(result.value.parameters).toEqual([10, Number.NEGATIVE_INFINITY, 20, 10, 20]);
    }
  });

  test('temporal binning binds the unit rather than interpolating it', () => {
    const result = compileBinStrategy({ kind: 'temporal', unit: 'quarter' }, '"order_date"');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('date_trunc(?, "order_date")');
      expect(result.value.parameters).toEqual(['quarter']);
    }
  });

  test('no strategy interpolates a number into the statement', () => {
    const strategies = [
      { kind: 'equalWidth' as const, binCount: 7 },
      { kind: 'quantile' as const, quantiles: 7 },
      { kind: 'explicit' as const, breaks: [7] },
    ];

    for (const strategy of strategies) {
      const result = compileBinStrategy(strategy, REFERENCE, { min: 0, max: 70 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sql).not.toContain('7');
      }
    }
  });
});
