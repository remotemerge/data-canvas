import { describe, expect, test } from 'bun:test';
import { convertArrowCell, convertArrowValue, readArrowRows, readScalarCount } from '@/data/duckdb/arrow-conversion.ts';
import type { ArrowRowSource } from '@/data/duckdb/arrow-conversion.ts';

// Minimal Arrow table stub used by converter tests.
const arrowTable = (columns: readonly (readonly unknown[])[], names: readonly string[]): ArrowRowSource => ({
  numRows: columns[0]?.length ?? 0,
  getChildAt: (index) => {
    const column = columns[index];

    return column === undefined ? null : { get: (row) => column[row] };
  },
  schema: { fields: names.map((name) => ({ name })) },
});

describe('convertArrowValue', () => {
  test('passes through primitives', () => {
    expect(convertArrowValue('text')).toBe('text');
    expect(convertArrowValue(42)).toBe(42);
    expect(convertArrowValue(0)).toBe(0);
    expect(convertArrowValue(true)).toBe(true);
    expect(convertArrowValue(false)).toBe(false);
  });

  test('normalizes both empty markers to null', () => {
    expect(convertArrowValue(null)).toBeNull();
    expect(convertArrowValue(undefined)).toBeNull();
  });

  test('converts a bigint within the safe range to a number', () => {
    expect(convertArrowValue(123n)).toBe(123);
    expect(convertArrowValue(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(convertArrowValue(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
  });

  test('keeps an oversized bigint exact by returning a string', () => {
    // Verify oversized bigint values keep exact decimal text.
    const oversized = BigInt(Number.MAX_SAFE_INTEGER) + 2n;

    expect(convertArrowValue(oversized)).toBe(oversized.toString());
    expect(convertArrowValue(-oversized)).toBe((-oversized).toString());
  });

  test('drops non-finite numbers, which have no JSON form and no axis position', () => {
    expect(convertArrowValue(Number.NaN)).toBeNull();
    expect(convertArrowValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(convertArrowValue(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  test('converts a date to an ISO string', () => {
    expect(convertArrowValue(new Date(Date.UTC(2026, 0, 15, 9, 30)))).toBe('2026-01-15T09:30:00.000Z');
  });

  test('treats an invalid date as null rather than as the string "Invalid Date"', () => {
    expect(convertArrowValue(new Date(Number.NaN))).toBeNull();
  });

  test('drops typed arrays, which have no scalar meaning', () => {
    expect(convertArrowValue(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test('stringifies anything unrecognized rather than passing an object through', () => {
    // Unknown objects become strings for renderers.
    expect(convertArrowValue({ toString: () => 'struct' })).toBe('struct');
  });
});

describe('convertArrowCell', () => {
  test('formats a date column as a calendar day', () => {
    expect(convertArrowCell(new Date(Date.UTC(2026, 0, 15)), 'date')).toBe('2026-01-15');
  });

  test('uses the UTC day rather than the local one', () => {
    // Date-only conversion must use UTC.
    expect(convertArrowCell(new Date(Date.UTC(2026, 0, 15, 0, 0, 0)), 'date')).toBe('2026-01-15');
  });

  test('keeps the time component for a timestamp column', () => {
    expect(convertArrowCell(new Date(Date.UTC(2026, 0, 15, 9, 30)), 'timestamp')).toBe('2026-01-15T09:30:00.000Z');
  });

  test('falls back to the type-blind conversion for every other type', () => {
    expect(convertArrowCell(7n, 'number')).toBe(7);
    expect(convertArrowCell(null, 'string')).toBeNull();
  });

  // DuckDB DATE values arrive as epoch milliseconds.
  test('reads a date delivered as epoch milliseconds', () => {
    expect(convertArrowCell(1_732_492_800_000, 'date')).toBe('2024-11-25');
  });

  test('reads a timestamp delivered as epoch milliseconds', () => {
    expect(convertArrowCell(1_732_492_800_000, 'timestamp')).toBe('2024-11-25T00:00:00.000Z');
  });

  test('reads a timestamp delivered as a bigint, which exceeds the number range for dates far out', () => {
    expect(convertArrowCell(1_732_492_800_000n, 'timestamp')).toBe('2024-11-25T00:00:00.000Z');
    expect(convertArrowCell(1_732_492_800_000n, 'date')).toBe('2024-11-25');
  });

  test('reads a pre-epoch date, where the millisecond value is negative', () => {
    expect(convertArrowCell(-86_400_000, 'date')).toBe('1969-12-31');
  });

  test('reads the epoch itself rather than treating zero as absent', () => {
    // Explicit null checks preserve epoch zero.
    expect(convertArrowCell(0, 'date')).toBe('1970-01-01');
  });

  test('a temporal column with a null value stays null', () => {
    expect(convertArrowCell(null, 'date')).toBeNull();
    expect(convertArrowCell(undefined, 'timestamp')).toBeNull();
  });

  test('an uninterpretable temporal value degrades rather than becoming Invalid Date', () => {
    expect(convertArrowCell('not a date', 'date')).toBe('not a date');
    expect(convertArrowCell(Number.NaN, 'date')).toBeNull();
    expect(convertArrowCell(Number.POSITIVE_INFINITY, 'timestamp')).toBeNull();
  });

  test('a numeric column is never mistaken for a temporal one', () => {
    // Logical type distinguishes epoch dates from numeric values.
    expect(convertArrowCell(1_732_492_800_000, 'number')).toBe(1_732_492_800_000);
  });
});

describe('readArrowRows', () => {
  test('reads rows in column order with per-column typing', () => {
    const table = arrowTable(
      [
        [1n, 2n],
        ['a', null],
        [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 2))],
      ],
      ['c0', 'c1', 'c2'],
    );

    const { rows, rowCount } = readArrowRows(table, ['number', 'string', 'date']);

    expect(rowCount).toBe(2);
    expect(rows).toEqual([
      [1, 'a', '2026-01-01'],
      [2, null, '2026-01-02'],
    ]);
  });

  test('returns no rows for an empty result', () => {
    expect(readArrowRows(arrowTable([[]], ['c0']), ['string'])).toEqual({ rows: [], rowCount: 0 });
  });

  test('a missing column yields nulls rather than throwing', () => {
    const table: ArrowRowSource = {
      numRows: 1,
      getChildAt: () => null,
      schema: { fields: [{ name: 'c0' }] },
    };

    expect(readArrowRows(table, ['string']).rows).toEqual([[null]]);
  });

  test('a short logical-type list falls back to the untyped conversion', () => {
    const table = arrowTable([[1n], ['x']], ['c0', 'c1']);

    expect(readArrowRows(table, ['number']).rows).toEqual([[1, 'x']]);
  });

  test('hostile cell content is carried through verbatim as a string', () => {
    // Preserve data values; renderers handle escaping.
    const hostile = '<img src=x onerror=alert(1)>';
    const table = arrowTable([[hostile]], ['c0']);

    expect(readArrowRows(table, ['string']).rows).toEqual([[hostile]]);
  });
});

describe('readScalarCount', () => {
  test('reads a bigint count', () => {
    expect(readScalarCount(arrowTable([[1000n]], ['count_star()']))).toBe(1000);
  });

  test('reads a numeric count', () => {
    expect(readScalarCount(arrowTable([[7]], ['count']))).toBe(7);
  });

  test('returns zero for an empty result', () => {
    expect(readScalarCount(arrowTable([[]], ['count']))).toBe(0);
  });

  test('returns zero for a null count', () => {
    expect(readScalarCount(arrowTable([[null]], ['count']))).toBe(0);
  });
});
