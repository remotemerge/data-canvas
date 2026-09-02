import { describe, expect, test } from 'bun:test';
import { compileFilterExpression, unqualifiedColumnReference } from '@/data/compiler/compile-filter-expression.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import { compilerDataset } from './compile-analysis-query.test.ts';

const compile = (expression: FilterExpression) => compileFilterExpression(expression, compilerDataset.columns);

const failureCode = (expression: FilterExpression): string => {
  const result = compile(expression);

  expect(result.ok).toBe(false);

  return result.ok ? '' : result.error.code;
};

const NAME_IS_A: FilterExpression = { kind: 'comparison', columnId: 'col_name', operator: 'eq', value: 'a' };
const VALUE_OVER_ONE: FilterExpression = { kind: 'comparison', columnId: 'col_value', operator: 'gt', value: 1 };

describe('compileFilterExpression', () => {
  test.each([
    ['eq', '"c1" = ?', [1]],
    ['neq', '"c1" <> ?', [1]],
    ['gt', '"c1" > ?', [1]],
    ['gte', '"c1" >= ?', [1]],
    ['lt', '"c1" < ?', [1]],
    ['lte', '"c1" <= ?', [1]],
  ] as const)('%s', (operator, sql, parameters) => {
    const result = compileFilterExpression(
      { kind: 'comparison', columnId: 'col_value', operator, value: 1 },
      compilerDataset.columns,
    );
    expect(result).toEqual({ ok: true, value: { sql, parameters: [...parameters] } });
  });

  test('compiles between, membership, contains, and null checks', () => {
    expect(
      compileFilterExpression(
        { kind: 'comparison', columnId: 'col_value', operator: 'between', value: [1, 2] },
        compilerDataset.columns,
      ),
    ).toEqual({ ok: true, value: { sql: '"c1" BETWEEN ? AND ?', parameters: [1, 2] } });
    expect(
      compileFilterExpression(
        { kind: 'comparison', columnId: 'col_name', operator: 'in', value: ['a', 'b'] },
        compilerDataset.columns,
      ),
    ).toEqual({ ok: true, value: { sql: '"c0" IN (?, ?)', parameters: ['a', 'b'] } });
    expect(
      compileFilterExpression(
        { kind: 'comparison', columnId: 'col_name', operator: 'contains', value: '100%' },
        compilerDataset.columns,
      ),
    ).toEqual({ ok: true, value: { sql: 'contains("c0", ?)', parameters: ['100%'] } });
    expect(
      compileFilterExpression(
        { kind: 'comparison', columnId: 'col_name', operator: 'is_null' },
        compilerDataset.columns,
      ),
    ).toEqual({ ok: true, value: { sql: '"c0" IS NULL', parameters: [] } });
  });

  test('not_in negates the membership test over the same bound values', () => {
    expect(compile({ kind: 'comparison', columnId: 'col_name', operator: 'not_in', value: ['a'] })).toEqual({
      ok: true,
      value: { sql: '"c0" NOT IN (?)', parameters: ['a'] },
    });
  });

  test('is_not_null needs no parameter', () => {
    expect(compile({ kind: 'comparison', columnId: 'col_name', operator: 'is_not_null' })).toEqual({
      ok: true,
      value: { sql: '"c0" IS NOT NULL', parameters: [] },
    });
  });
});

describe('filter tree composition', () => {
  test('not wraps its operand so the negation binds to the whole fragment', () => {
    expect(compile({ kind: 'not', operand: NAME_IS_A })).toEqual({
      ok: true,
      value: { sql: 'NOT ("c0" = ?)', parameters: ['a'] },
    });
  });

  test('and joins parenthesized operands in order', () => {
    expect(compile({ kind: 'and', operands: [NAME_IS_A, VALUE_OVER_ONE] })).toEqual({
      ok: true,
      value: { sql: '("c0" = ?) AND ("c1" > ?)', parameters: ['a', 1] },
    });
  });

  test('or joins parenthesized operands in order', () => {
    expect(compile({ kind: 'or', operands: [NAME_IS_A, VALUE_OVER_ONE] })).toEqual({
      ok: true,
      value: { sql: '("c0" = ?) OR ("c1" > ?)', parameters: ['a', 1] },
    });
  });

  // An empty conjunction has no truth value to emit, and guessing one would silently change the result.
  test.each(['and', 'or'] as const)('an empty %s is refused rather than compiled to a constant', (kind) => {
    expect(failureCode({ kind, operands: [] })).toBe('INVALID_TOOL_ARGUMENTS');
  });

  test('a failure inside a branch fails the whole tree', () => {
    expect(
      failureCode({
        kind: 'and',
        operands: [NAME_IS_A, { kind: 'comparison', columnId: 'col_missing', operator: 'eq', value: 1 }],
      }),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test('accepts a resolver function in place of a column list', () => {
    expect(
      compileFilterExpression(
        { kind: 'or', operands: [NAME_IS_A] },
        unqualifiedColumnReference(compilerDataset.columns),
      ).ok,
    ).toBe(true);
  });
});

describe('filter compilation refusals', () => {
  test('an unknown column fails instead of emitting a bare reference', () => {
    expect(failureCode({ kind: 'comparison', columnId: 'col_missing', operator: 'eq', value: 1 })).toBe(
      'COLUMN_NOT_FOUND',
    );
  });

  // `contains` is a text predicate; applying it to a number would compare against a coerced string.
  test('an operator the column type cannot support is refused', () => {
    expect(failureCode({ kind: 'comparison', columnId: 'col_value', operator: 'contains', value: 'bad' })).toBe(
      'INCOMPATIBLE_COLUMN',
    );
  });

  // The operator reaches the compiler as data, so one outside the closed set emits no SQL at all.
  test('an operator outside the closed set is refused as unsupported', () => {
    expect(
      failureCode({
        kind: 'comparison',
        columnId: 'col_name',
        operator: 'unsupported' as never,
        value: 'x',
      }),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('the unqualified resolver returns nothing for a column the relation does not hold', () => {
    expect(unqualifiedColumnReference(compilerDataset.columns)('col_missing')).toBeUndefined();
  });
});
