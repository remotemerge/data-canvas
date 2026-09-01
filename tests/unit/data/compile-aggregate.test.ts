import { describe, expect, test } from 'bun:test';
import { compileAggregate } from '@/data/compiler/compile-aggregate.ts';
import { column } from '../application/action-fixtures.ts';
import { compilerDataset } from './compile-analysis-query.test.ts';

describe('compileAggregate', () => {
  test('maps every aggregate', () => {
    const numeric = compilerDataset.columns[1];
    expect(compileAggregate('count')).toEqual({ ok: true, value: 'COUNT(*)' });
    expect(compileAggregate('count_distinct', numeric)).toEqual({ ok: true, value: 'COUNT(DISTINCT "c1")' });
    for (const aggregate of ['sum', 'avg', 'min', 'max', 'median'] as const) {
      expect(compileAggregate(aggregate, numeric).ok).toBe(true);
    }
  });

  test('rejects numeric aggregates on text', () => {
    const result = compileAggregate('sum', compilerDataset.columns[0]);
    expect(result.ok ? null : result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });

  // Only `count` operates without a column, so every other aggregate must say what is missing.
  test('rejects a column-requiring aggregate when no column is resolved', () => {
    const result = compileAggregate('sum');
    expect(result.ok ? null : result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  // Extrema are ordered comparisons, so a date column is a valid input even though `sum` is not.
  test('min and max also accept temporal columns', () => {
    const orderDate = column('col_date', 'order_date', 'date');
    expect(compileAggregate('min', orderDate).ok).toBe(true);
    expect(compileAggregate('max', orderDate).ok).toBe(true);
    expect(compileAggregate('avg', orderDate).ok).toBe(false);
  });

  // The sample estimator is named explicitly so the emitted SQL states which definition applies.
  test('stddev compiles to the sample estimator', () => {
    expect(compileAggregate('stddev', compilerDataset.columns[1])).toEqual({
      ok: true,
      value: 'stddev_samp("c1")',
    });
  });

  // A caller-supplied reference replaces the quoted physical name, which joins rely on.
  test('an explicit reference overrides the quoted physical name', () => {
    expect(compileAggregate('sum', compilerDataset.columns[1], 't0."c1"')).toEqual({
      ok: true,
      value: 'SUM(t0."c1")',
    });
  });
});
