import { describe, expect, test } from 'bun:test';
import { MAX_FILTER_VALUE_LIST_LENGTH, validateFilter } from '@/application/validation/validate-filter.ts';
import { FILTER_OPERATORS } from '@/domain/filter/filter.ts';
import type { FilterOperator } from '@/domain/filter/filter.ts';
import { LOGICAL_TYPES } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { column } from './action-fixtures.ts';

/** A representative valid value for each logical type, used to probe operator compatibility. */
const sampleValue: Record<LogicalType, unknown> = {
  number: 42,
  string: 'north',
  boolean: true,
  date: '2026-01-15',
  timestamp: '2026-01-15T10:30:00.000Z',
  category: 'north',
  unknown: 'anything',
};

/**
 * The full compatibility matrix, asserted exhaustively rather than sampled.
 *
 * `true` means the operator is legal against that column type when given a well-typed value. A new
 * logical type or operator fails this table until someone classifies it, which is the point:
 * silently defaulting a new pair to "allowed" would let it reach the query compiler unchecked.
 */
const isCompatible: Record<FilterOperator, Record<LogicalType, boolean>> = {
  eq: { number: true, string: true, boolean: true, date: true, timestamp: true, category: true, unknown: true },
  neq: { number: true, string: true, boolean: true, date: true, timestamp: true, category: true, unknown: true },
  gt: { number: true, string: false, boolean: false, date: true, timestamp: true, category: false, unknown: false },
  gte: { number: true, string: false, boolean: false, date: true, timestamp: true, category: false, unknown: false },
  lt: { number: true, string: false, boolean: false, date: true, timestamp: true, category: false, unknown: false },
  lte: { number: true, string: false, boolean: false, date: true, timestamp: true, category: false, unknown: false },
  between: {
    number: true,
    string: false,
    boolean: false,
    date: true,
    timestamp: true,
    category: false,
    unknown: false,
  },
  in: { number: true, string: true, boolean: true, date: true, timestamp: true, category: true, unknown: true },
  not_in: { number: true, string: true, boolean: true, date: true, timestamp: true, category: true, unknown: true },
  contains: {
    number: false,
    string: true,
    boolean: false,
    date: false,
    timestamp: false,
    category: true,
    unknown: false,
  },
  is_null: { number: true, string: true, boolean: true, date: true, timestamp: true, category: true, unknown: true },
  is_not_null: {
    number: true,
    string: true,
    boolean: true,
    date: true,
    timestamp: true,
    category: true,
    unknown: true,
  },
};

/** Builds the value shape each operator expects, from a single well-typed sample. */
const valueFor = (operator: FilterOperator, logicalType: LogicalType): unknown => {
  const sample = sampleValue[logicalType];

  switch (operator) {
    case 'is_null':
    case 'is_not_null':
      return undefined;
    case 'between':
      return [sample, sample];
    case 'in':
    case 'not_in':
      return [sample];
    default:
      return sample;
  }
};

describe('filter operator and column type matrix', () => {
  const cases = FILTER_OPERATORS.flatMap((operator) =>
    LOGICAL_TYPES.map((logicalType) => [operator, logicalType] as const),
  );

  test('the matrix covers every operator and every logical type exactly once', () => {
    expect(Object.keys(isCompatible).toSorted()).toEqual([...FILTER_OPERATORS].toSorted());

    for (const row of Object.values(isCompatible)) {
      expect(Object.keys(row).toSorted()).toEqual([...LOGICAL_TYPES].toSorted());
    }

    expect(cases).toHaveLength(FILTER_OPERATORS.length * LOGICAL_TYPES.length);
  });

  test.each(cases)('%s against a %s column', (operator, logicalType) => {
    const target = column('col_probe', 'probe', logicalType);
    const result = validateFilter(target, operator, valueFor(operator, logicalType));

    expect(result.ok).toBe(isCompatible[operator][logicalType]);
  });

  test.each(cases.filter(([operator, logicalType]) => !isCompatible[operator][logicalType]))(
    'rejecting %s on a %s column names the column and the operator, never a value',
    (operator, logicalType) => {
      const target = column('col_probe', 'probe', logicalType);
      const result = validateFilter(target, operator, valueFor(operator, logicalType));

      expect(result.ok).toBe(false);

      if (result.ok) return;

      expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
      expect(result.error.message).toContain('probe');
      expect(result.error.message).toContain(operator);
      expect(result.error.message).not.toContain(String(sampleValue[logicalType]));
    },
  );
});

describe('value shape rules', () => {
  const numeric = column('col_revenue', 'revenue', 'number');
  const text = column('col_region', 'region', 'category');

  test('between requires exactly two bounds', () => {
    expect(validateFilter(numeric, 'between', [1]).ok).toBe(false);
    expect(validateFilter(numeric, 'between', [1, 2, 3]).ok).toBe(false);
    expect(validateFilter(numeric, 'between', 1).ok).toBe(false);
    expect(validateFilter(numeric, 'between', [1, 2]).ok).toBe(true);
  });

  test('between requires lower <= upper, for numbers and dates alike', () => {
    expect(validateFilter(numeric, 'between', [5, 1]).ok).toBe(false);
    expect(validateFilter(numeric, 'between', [5, 5]).ok).toBe(true);

    const dates = column('col_date', 'order_date', 'date');

    expect(validateFilter(dates, 'between', ['2026-03-01', '2026-01-01']).ok).toBe(false);
    expect(validateFilter(dates, 'between', ['2026-01-01', '2026-03-01']).ok).toBe(true);
  });

  test('between rejects a mistyped bound', () => {
    expect(validateFilter(numeric, 'between', [1, 'two']).ok).toBe(false);
  });

  test('in and not_in require a non-empty list', () => {
    expect(validateFilter(text, 'in', []).ok).toBe(false);
    expect(validateFilter(text, 'not_in', []).ok).toBe(false);
    expect(validateFilter(text, 'in', 'north').ok).toBe(false);
    expect(validateFilter(text, 'in', ['north']).ok).toBe(true);
  });

  test('in is bounded, so an agent cannot submit an unbounded membership list', () => {
    const withinBound = Array.from({ length: MAX_FILTER_VALUE_LIST_LENGTH }, (_, index) => `v${index}`);
    const overBound = validateFilter(text, 'in', [...withinBound, 'one-too-many']);

    expect(validateFilter(text, 'in', withinBound).ok).toBe(true);
    expect(overBound.ok).toBe(false);
    expect(overBound.ok ? null : overBound.error.code).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('in rejects a list containing a mistyped entry', () => {
    expect(validateFilter(numeric, 'in', [1, 2, 'three']).ok).toBe(false);
  });

  test('nullary operators reject any value', () => {
    expect(validateFilter(numeric, 'is_null', undefined).ok).toBe(true);
    expect(validateFilter(numeric, 'is_null', null).ok).toBe(false);
    expect(validateFilter(numeric, 'is_not_null', 1).ok).toBe(false);
  });

  test('eq and neq require a value; missing values use is_null instead', () => {
    const result = validateFilter(numeric, 'eq', undefined);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.message).toContain('is_null');
  });

  test('contains requires non-empty text', () => {
    expect(validateFilter(text, 'contains', '').ok).toBe(false);
    expect(validateFilter(text, 'contains', 5).ok).toBe(false);
    expect(validateFilter(text, 'contains', 'nor').ok).toBe(true);
  });

  test('ordered operators require a value', () => {
    expect(validateFilter(numeric, 'gt', undefined).ok).toBe(false);
  });

  test('temporal columns accept ISO strings and epoch milliseconds', () => {
    const timestamps = column('col_ts', 'observed_at', 'timestamp');

    expect(validateFilter(timestamps, 'gt', '2026-01-15T10:30:00.000Z').ok).toBe(true);
    expect(validateFilter(timestamps, 'gt', 1_768_473_000_000).ok).toBe(true);
    expect(validateFilter(timestamps, 'gt', 'not-a-date').ok).toBe(false);
  });

  test('numeric columns reject non-finite values', () => {
    expect(validateFilter(numeric, 'gt', Number.NaN).ok).toBe(false);
    expect(validateFilter(numeric, 'gt', Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  test('an unclassified column defers type judgement but still rejects an absent value', () => {
    const unclassified = column('col_x', 'mystery', 'unknown');

    expect(validateFilter(unclassified, 'eq', 'anything').ok).toBe(true);
    expect(validateFilter(unclassified, 'eq', null).ok).toBe(false);
  });
});
