import { describe, expect, test } from 'bun:test';
import { compileFilterExpression } from '@/data/compiler/compile-filter-expression.ts';
import { compilerDataset } from './compile-analysis-query.test.ts';

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
});
