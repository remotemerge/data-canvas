import { describe, expect, test } from 'bun:test';
import { validateBinStrategy } from '@/application/validation/validate-bin-strategy.ts';
import {
  BIN_STRATEGY_KINDS,
  MAX_BIN_COUNT,
  MAX_EXPLICIT_BREAKS,
  MAX_QUANTILE_COUNT,
  MIN_BIN_COUNT,
  MIN_QUANTILE_COUNT,
  TEMPORAL_UNITS,
  needsColumnRange,
} from '@/domain/analysis/bin-strategy.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import { SELECTION_LINK_MODES, isSelectionLinkMode } from '@/domain/visualization/selection-link-mode.ts';

describe('bin strategy bounds', () => {
  test('every strategy kind has a valid example, so no kind is unreachable', () => {
    const valid: Record<BinStrategy['kind'], BinStrategy> = {
      equalWidth: { kind: 'equalWidth', binCount: 20 },
      equalWidthOf: { kind: 'equalWidthOf', width: 5 },
      quantile: { kind: 'quantile', quantiles: 4 },
      explicit: { kind: 'explicit', breaks: [0, 10, 100] },
      temporal: { kind: 'temporal', unit: 'month' },
    };

    expect(Object.keys(valid).toSorted()).toEqual([...BIN_STRATEGY_KINDS].toSorted());

    for (const strategy of Object.values(valid)) {
      expect(validateBinStrategy(strategy).ok).toBe(true);
    }
  });

  test('equalWidth accepts the boundary counts and rejects just outside them', () => {
    expect(validateBinStrategy({ kind: 'equalWidth', binCount: MIN_BIN_COUNT }).ok).toBe(true);
    expect(validateBinStrategy({ kind: 'equalWidth', binCount: MAX_BIN_COUNT }).ok).toBe(true);
    expect(validateBinStrategy({ kind: 'equalWidth', binCount: MIN_BIN_COUNT - 1 }).ok).toBe(false);
    expect(validateBinStrategy({ kind: 'equalWidth', binCount: MAX_BIN_COUNT + 1 }).ok).toBe(false);
  });

  test('a fractional bucket count is rejected rather than truncated', () => {
    expect(validateBinStrategy({ kind: 'equalWidth', binCount: 10.5 }).ok).toBe(false);
  });

  test('an over-large bucket count reports the result-size code an agent can branch on', () => {
    const result = validateBinStrategy({ kind: 'equalWidth', binCount: 5000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RESULT_LIMIT_EXCEEDED');
    }
  });

  test('a non-positive width would make the bucket count unbounded', () => {
    expect(validateBinStrategy({ kind: 'equalWidthOf', width: 0 }).ok).toBe(false);
    expect(validateBinStrategy({ kind: 'equalWidthOf', width: -1 }).ok).toBe(false);
    expect(validateBinStrategy({ kind: 'equalWidthOf', width: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  test('a width that is not a number at all is refused', () => {
    expect(validateBinStrategy({ kind: 'equalWidthOf', width: Number.NaN }).ok).toBe(false);
  });

  test('a fractional quantile count is refused, since quantiles are whole splits', () => {
    expect(validateBinStrategy({ kind: 'quantile', quantiles: 2.2 }).ok).toBe(false);
  });

  test('quantiles stay inside their own tighter range', () => {
    expect(validateBinStrategy({ kind: 'quantile', quantiles: MIN_QUANTILE_COUNT }).ok).toBe(true);
    expect(validateBinStrategy({ kind: 'quantile', quantiles: MAX_QUANTILE_COUNT }).ok).toBe(true);
    expect(validateBinStrategy({ kind: 'quantile', quantiles: MAX_QUANTILE_COUNT + 1 }).ok).toBe(false);
  });

  test('explicit breaks must be strictly ascending, since the compiled arms depend on the order', () => {
    expect(validateBinStrategy({ kind: 'explicit', breaks: [0, 5, 10] }).ok).toBe(true);
    expect(validateBinStrategy({ kind: 'explicit', breaks: [10, 5, 0] }).ok).toBe(false);
    // Equal neighbours would produce an unreachable arm.
    expect(validateBinStrategy({ kind: 'explicit', breaks: [0, 5, 5] }).ok).toBe(false);
  });

  test('explicit breaks are bounded in count and must be finite', () => {
    expect(validateBinStrategy({ kind: 'explicit', breaks: [] }).ok).toBe(false);
    expect(
      validateBinStrategy({
        kind: 'explicit',
        breaks: Array.from({ length: MAX_EXPLICIT_BREAKS + 1 }, (_unused, index) => index),
      }).ok,
    ).toBe(false);
    expect(validateBinStrategy({ kind: 'explicit', breaks: [0, Number.NaN] }).ok).toBe(false);
    expect(validateBinStrategy({ kind: 'explicit', breaks: [0, Number.POSITIVE_INFINITY] }).ok).toBe(false);
  });

  test('an unrecognized temporal unit is refused', () => {
    expect(validateBinStrategy({ kind: 'temporal', unit: 'fortnight' as 'day' }).ok).toBe(false);
  });

  test.each(TEMPORAL_UNITS.map((unit) => [unit] as const))('the %s temporal unit is accepted', (unit) => {
    expect(validateBinStrategy({ kind: 'temporal', unit }).ok).toBe(true);
  });
});

describe('needsColumnRange', () => {
  // Equal-width buckets divide a span, so the compiler has to read the column min and max first.
  test('an equal-width strategy needs the column range', () => {
    expect(needsColumnRange({ kind: 'equalWidth', binCount: 4 })).toBe(true);
  });

  // Quantiles are computed from the distribution itself, so no separate range query is needed.
  test('a quantile strategy does not need the column range', () => {
    expect(needsColumnRange({ kind: 'quantile', quantiles: 4 })).toBe(false);
  });
});

describe('selection link mode guard', () => {
  test.each(SELECTION_LINK_MODES.map((mode) => [mode] as const))('%s is recognized as a link mode', (mode) => {
    expect(isSelectionLinkMode(mode)).toBe(true);
  });

  // The value arrives from a tool payload, so anything outside the closed set is refused.
  test('an unrecognized string is not a link mode', () => {
    expect(isSelectionLinkMode('other')).toBe(false);
  });

  test('a non-string value is not a link mode', () => {
    expect(isSelectionLinkMode(1)).toBe(false);
  });
});
