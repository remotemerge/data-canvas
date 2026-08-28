import { describe, expect, test } from 'bun:test';
import { compileAggregate } from '@/data/compiler/compile-aggregate.ts';
import { compilerDataset } from './compile-analysis-query.test.ts';

describe('compileAggregate', () => {
  test('maps every aggregate', () => {
    const numeric = compilerDataset.columns[1];
    expect(compileAggregate('count')).toEqual({ ok: true, value: 'COUNT(*)' });
    expect(compileAggregate('count_distinct', numeric)).toEqual({ ok: true, value: 'COUNT(DISTINCT "c1")' });
    for (const aggregate of ['sum', 'avg', 'min', 'max', 'median'] as const)
      expect(compileAggregate(aggregate, numeric).ok).toBe(true);
  });

  test('rejects numeric aggregates on text', () => {
    const result = compileAggregate('sum', compilerDataset.columns[0]);
    expect(result.ok ? null : result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });
});
