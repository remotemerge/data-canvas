import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery } from '@/data/compiler/compile-analysis-query.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
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

  test('a derived literal stays a bound parameter through the whole query', () => {
    const hostile = "'; DROP TABLE data; --";
    const derived: DerivedColumn = {
      id: 'col_derived',
      datasetId: compilerDataset.id,
      name: 'Tagged',
      expression: {
        kind: 'case',
        when: [
          {
            left: { kind: 'column', columnId: 'col_value' },
            operator: 'gt',
            right: { kind: 'literal', value: 0 },
            result: { kind: 'literal', value: hostile },
          },
        ],
        otherwise: { kind: 'literal', value: null },
      },
      logicalType: 'string',
      typeVerified: false,
      createdBy: 'agent',
    };

    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: ['col_derived'],
        measures: [{ aggregate: 'count' }],
        filters: [],
      },
      { datasets: [compilerDataset], derivedColumns: { col_derived: derived } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).not.toContain(hostile);
    expect(result.value.parameters).toContain(hostile);
  });

  test('a derived column display name never becomes an identifier', () => {
    const hostile = '"; DROP TABLE data; --';
    const derived: DerivedColumn = {
      id: 'col_derived',
      datasetId: compilerDataset.id,
      name: hostile,
      expression: { kind: 'column', columnId: 'col_value' },
      logicalType: 'number',
      typeVerified: false,
      createdBy: 'agent',
    };

    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: ['col_derived'],
        measures: [{ aggregate: 'count' }],
        filters: [],
      },
      { datasets: [compilerDataset], derivedColumns: { col_derived: derived } },
    );

    expect(result.ok && result.value.sql).not.toContain(hostile);
  });

  test('bin boundaries bind rather than interpolate, across every strategy', () => {
    // Each strategy binds a different number, so the marker is the one that strategy actually
    // carries. Finding it in the SQL could only mean it was interpolated.
    const cases: { strategy: BinStrategy; marker: number }[] = [
      { strategy: { kind: 'equalWidth', binCount: 2 }, marker: 9_182_736 },
      { strategy: { kind: 'quantile', quantiles: 17 }, marker: 17 },
      { strategy: { kind: 'explicit', breaks: [9_182_736] }, marker: 9_182_736 },
    ];

    for (const { strategy, marker } of cases) {
      const result = compileAnalysisQuery(
        {
          datasetId: compilerDataset.id,
          dimensions: [],
          binnedDimensions: [{ columnId: 'col_value', strategy, range: { min: 9_182_736, max: 9_182_736 * 3 } }],
          measures: [{ aggregate: 'count' }],
          filters: [],
        },
        compilerDataset,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      expect(result.value.sql).not.toContain(String(marker));
      expect(result.value.parameters).toContain(marker);
    }
  });

  test('a distribution query emits only generated aliases', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: [],
        measures: [],
        distribution: { columnId: 'col_value', categoryColumnId: 'col_name' },
        filters: [],
      },
      compilerDataset,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toContain('quantile_cont');
    expect(result.value.sql).not.toContain('FILTER');
    // The summary columns are fixed names this module chooses, never caller text.
    for (const key of ['q0', 'q1', 'q2', 'q3', 'q4']) {
      expect(result.value.sql).toContain(`"${key}"`);
    }
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
