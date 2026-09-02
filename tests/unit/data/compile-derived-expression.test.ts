import { describe, expect, test } from 'bun:test';
import { compileDerivedExpression } from '@/data/compiler/compile-derived-expression.ts';
import { unqualifiedColumnReference } from '@/data/compiler/compile-filter-expression.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import { SALES_COLUMNS } from '../application/action-fixtures.ts';

const resolve = unqualifiedColumnReference(SALES_COLUMNS);

const compile = (expression: DerivedExpression, derivedColumns: Record<string, DerivedColumn> = {}) =>
  compileDerivedExpression(expression, { resolve, derivedColumns });

const failureCode = (expression: DerivedExpression): string => {
  const result = compile(expression);

  expect(result.ok).toBe(false);

  return result.ok ? '' : result.error.code;
};

const REVENUE: DerivedExpression = { kind: 'column', columnId: 'col_revenue' };
const UNITS: DerivedExpression = { kind: 'column', columnId: 'col_units' };

describe('derived expression compilation', () => {
  test('a column compiles to its quoted physical name with no parameters', () => {
    const result = compile(REVENUE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('"revenue"');
      expect(result.value.parameters).toEqual([]);
    }
  });

  test('a literal never reaches the statement as text', () => {
    const result = compile({ kind: 'literal', value: "'; DROP TABLE sales; --" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('?');
      expect(result.value.parameters).toEqual(["'; DROP TABLE sales; --"]);
    }
  });

  test('division guards the denominator so a zero yields NULL rather than failing the query', () => {
    const result = compile({ kind: 'arithmetic', op: 'div', left: REVENUE, right: UNITS });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('("revenue" / NULLIF("units", 0))');
    }
  });

  test('the other operators need no guard', () => {
    for (const [op, symbol] of [
      ['add', '+'],
      ['sub', '-'],
      ['mul', '*'],
    ] as const) {
      const result = compile({ kind: 'arithmetic', op, left: REVENUE, right: UNITS });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sql).toBe(`("revenue" ${symbol} "units")`);
      }
    }
  });

  test('a date part maps the field name to DuckDB date_part', () => {
    const result = compile({ kind: 'datePart', part: 'dayOfWeek', columnId: 'col_date' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('date_part(\'dow\', "order_date")');
      expect(result.value.parameters).toEqual([]);
    }
  });

  test('a cast uses TRY_CAST so an unconvertible value becomes NULL', () => {
    const result = compile({ kind: 'cast', to: 'number', expr: { kind: 'column', columnId: 'col_notes' } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('TRY_CAST("notes" AS DOUBLE)');
    }
  });

  test('a case emits one arm per condition and binds every literal', () => {
    const result = compile({
      kind: 'case',
      when: [
        {
          left: REVENUE,
          operator: 'gt',
          right: { kind: 'literal', value: 100 },
          result: { kind: 'literal', value: 'high' },
        },
      ],
      otherwise: { kind: 'literal', value: 'low' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('CASE WHEN "revenue" > ? THEN ? ELSE ? END');
      expect(result.value.parameters).toEqual([100, 'high', 'low']);
    }
  });

  test('a case with no arms is refused rather than emitting an empty CASE', () => {
    expect(compile({ kind: 'case', when: [], otherwise: { kind: 'literal', value: 0 } }).ok).toBe(false);
  });

  test('an unknown column fails instead of emitting a bare reference', () => {
    const result = compile({ kind: 'column', columnId: 'col_missing' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  test('a derived reference is inlined, since SQL cannot name a sibling select alias in GROUP BY', () => {
    const derived: DerivedColumn = {
      id: 'col_rpu',
      datasetId: 'ds_sales',
      name: 'Revenue per unit',
      expression: { kind: 'arithmetic', op: 'div', left: REVENUE, right: UNITS },
      logicalType: 'number',
      typeVerified: false,
      createdBy: 'human',
    };

    const result = compile({ kind: 'column', columnId: 'col_rpu' }, { col_rpu: derived });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe('("revenue" / NULLIF("units", 0))');
    }
  });

  test('a cyclic derived reference stops at the depth backstop rather than recursing forever', () => {
    const looping: DerivedColumn = {
      id: 'col_loop',
      datasetId: 'ds_sales',
      name: 'Loop',
      expression: { kind: 'column', columnId: 'col_loop' },
      logicalType: 'number',
      typeVerified: false,
      createdBy: 'agent',
    };

    const result = compile({ kind: 'column', columnId: 'col_loop' }, { col_loop: looping });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
    }
  });

  // An operator outside the allowlist must not reach the statement, whatever a caller sends.
  test('an unrecognized arithmetic operator is refused rather than interpolated', () => {
    expect(
      failureCode({ kind: 'arithmetic', op: 'mod' as never, left: REVENUE, right: UNITS } as DerivedExpression),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('an unrecognized comparison operator in a case arm is refused', () => {
    expect(
      failureCode({
        kind: 'case',
        when: [
          {
            left: REVENUE,
            operator: 'is_null' as never,
            right: { kind: 'literal', value: 1 },
            result: { kind: 'literal', value: 'high' },
          },
        ],
        otherwise: { kind: 'literal', value: 'low' },
      } as DerivedExpression),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  /*
   * Each operand compiles independently, so a failure on either side must abort before the operator is
   * emitted. Compiling only the left would otherwise produce a fragment with a missing right-hand side.
   */
  test('an unknown column on either side of an arithmetic operator fails', () => {
    const missing: DerivedExpression = { kind: 'column', columnId: 'col_missing' };

    expect(failureCode({ kind: 'arithmetic', op: 'add', left: missing, right: REVENUE })).toBe('COLUMN_NOT_FOUND');
    expect(failureCode({ kind: 'arithmetic', op: 'add', left: REVENUE, right: missing })).toBe('COLUMN_NOT_FOUND');
  });

  // A case arm compiles three sub-expressions, and any one of them can refuse the whole statement.
  test('an unknown column in a case arm left, right, or result fails', () => {
    const missing: DerivedExpression = { kind: 'column', columnId: 'col_missing' };
    const literal: DerivedExpression = { kind: 'literal', value: 1 };

    for (const arm of [
      { left: missing, operator: 'gt', right: literal, result: literal },
      { left: REVENUE, operator: 'gt', right: missing, result: literal },
      { left: REVENUE, operator: 'gt', right: literal, result: missing },
    ] as const) {
      expect(failureCode({ kind: 'case', when: [arm], otherwise: literal })).toBe('COLUMN_NOT_FOUND');
    }
  });

  test('an unknown column in the else branch fails the whole case', () => {
    expect(
      failureCode({
        kind: 'case',
        when: [
          {
            left: REVENUE,
            operator: 'gt',
            right: { kind: 'literal', value: 1 },
            result: { kind: 'literal', value: 'high' },
          },
        ],
        otherwise: { kind: 'column', columnId: 'col_missing' },
      }),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test.each([
    ['year', 'year'],
    ['quarter', 'quarter'],
    ['month', 'month'],
    ['week', 'week'],
    ['day', 'day'],
    ['hour', 'hour'],
    ['dayOfWeek', 'dow'],
  ] as const)('the %s date part maps to the DuckDB field %s', (part, field) => {
    const result = compile({ kind: 'datePart', part, columnId: 'col_date' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe(`date_part('${field}', "order_date")`);
    }
  });

  test('an unrecognized date part is refused', () => {
    expect(failureCode({ kind: 'datePart', part: 'minute' as never, columnId: 'col_date' } as DerivedExpression)).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('a date part over an unknown column fails', () => {
    expect(failureCode({ kind: 'datePart', part: 'year', columnId: 'col_missing' })).toBe('COLUMN_NOT_FOUND');
  });

  // An equal-width bucket needs the column's range, which only the caller's lookup can supply.
  test('a bin expression compiles its strategy against the range the context supplies', () => {
    const result = compileDerivedExpression(
      { kind: 'bin', columnId: 'col_revenue', strategy: { kind: 'equalWidth', binCount: 4 } },
      { resolve, derivedColumns: {}, rangeFor: () => ({ min: 0, max: 100 }) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toContain('"revenue"');
    }
  });

  test('a bin expression with no range available is refused', () => {
    expect(failureCode({ kind: 'bin', columnId: 'col_revenue', strategy: { kind: 'equalWidth', binCount: 4 } })).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('a bin over an unknown column fails', () => {
    expect(failureCode({ kind: 'bin', columnId: 'col_missing', strategy: { kind: 'equalWidth', binCount: 4 } })).toBe(
      'COLUMN_NOT_FOUND',
    );
  });

  test.each([
    ['number', 'DOUBLE'],
    ['string', 'VARCHAR'],
    ['date', 'TIMESTAMP'],
  ] as const)('a %s cast targets the %s database type', (to, databaseType) => {
    const result = compile({ kind: 'cast', to, expr: REVENUE });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sql).toBe(`TRY_CAST("revenue" AS ${databaseType})`);
    }
  });

  test('an unrecognized cast target is refused', () => {
    expect(failureCode({ kind: 'cast', to: 'boolean' as never, expr: REVENUE } as DerivedExpression)).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('an unknown column under a cast fails', () => {
    expect(failureCode({ kind: 'cast', to: 'number', expr: { kind: 'column', columnId: 'col_missing' } })).toBe(
      'COLUMN_NOT_FOUND',
    );
  });

  // The depth backstop also bounds a legitimately deep tree, not only a cyclic reference.
  test('an expression nested past the depth backstop is refused', () => {
    let deep: DerivedExpression = { kind: 'literal', value: 1 };

    for (let index = 0; index < 34; index += 1) {
      deep = { kind: 'cast', to: 'number', expr: deep };
    }

    expect(failureCode(deep)).toBe('UNSUPPORTED_OPERATION');
  });

  test('no compiled fragment interpolates a value, whatever the literal contains', () => {
    const hostile = ['"; DROP TABLE x; --', "' OR 1=1 --", '\\"; SELECT 1; --'];

    for (const value of hostile) {
      const result = compile({
        kind: 'arithmetic',
        op: 'add',
        left: REVENUE,
        right: { kind: 'literal', value },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sql).not.toContain(value);
        expect(result.value.parameters).toContain(value);
      }
    }
  });
});
