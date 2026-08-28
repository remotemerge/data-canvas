import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery } from '@/data/compiler/compile-analysis-query.ts';
import { compilerDataset } from './compile-analysis-query.test.ts';

describe('compiler injection boundaries', () => {
  test.each(["'; DROP TABLE users; --", '100%', 'a_b', '＂; DROP TABLE x', 'e\u0301; SELECT 1'])(
    'keeps filter value out of SQL: %s',
    (hostile) => {
      const result = compileAnalysisQuery(
        {
          datasetId: compilerDataset.id,
          dimensions: [],
          measures: [],
          filters: [{ kind: 'comparison', columnId: 'col_name', operator: 'contains', value: hostile }],
        },
        compilerDataset,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.sql).not.toContain(hostile);
      expect(result.value.parameters).toContain(hostile);
    },
  );

  test('keeps every membership value out of SQL', () => {
    const values = ["x'); DELETE FROM data; --", 'normal'];
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: [],
        measures: [],
        filters: [{ kind: 'comparison', columnId: 'col_name', operator: 'in', value: values }],
      },
      compilerDataset,
    );
    expect(result.ok && result.value.parameters).toEqual(values);
    expect(result.ok && result.value.sql).not.toContain(values[0] as string);
  });

  test('display names and measure aliases never become identifiers', () => {
    const hostile = '"; DROP TABLE data; --';
    const dataset = {
      ...compilerDataset,
      columns: [{ ...compilerDataset.columns[0]!, name: hostile }, compilerDataset.columns[1]!],
    };
    const result = compileAnalysisQuery(
      {
        datasetId: dataset.id,
        dimensions: ['col_name'],
        measures: [{ aggregate: 'count', alias: hostile }],
        filters: [],
        orderBy: [{ measureAlias: hostile, direction: 'asc' }],
      },
      dataset,
    );
    expect(result.ok && result.value.sql).not.toContain(hostile);
  });
});
