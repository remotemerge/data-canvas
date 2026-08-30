import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery, DEFAULT_QUERY_LIMIT } from '@/data/compiler/compile-analysis-query.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';

export const compilerDataset: Dataset = {
  id: 'ds_test',
  name: 'Test',
  relationId: 'dataset_test',
  source: { kind: 'csv', fileName: 'test.csv', byteSize: 1, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 2,
  revision: 1,
  importStatus: 'ready',
  columns: [
    {
      id: 'col_name',
      name: 'Name',
      physicalName: 'c0',
      databaseType: 'VARCHAR',
      logicalType: 'string',
      nullable: false,
    },
    {
      id: 'col_value',
      name: 'Value',
      physicalName: 'c1',
      databaseType: 'DOUBLE',
      logicalType: 'number',
      nullable: false,
    },
  ],
};

/** The compiler dataset plus a temporal column, for the binning cases only. */
const temporalDataset: Dataset = {
  ...compilerDataset,
  columns: [
    ...compilerDataset.columns,
    {
      id: 'col_date',
      name: 'Date',
      physicalName: 'c2',
      databaseType: 'DATE',
      logicalType: 'date',
      nullable: false,
    },
  ],
};

describe('compileAnalysisQuery', () => {
  test('compiles projection, filter, sort, limit, and offset', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: [],
        measures: [],
        filters: [{ kind: 'comparison', columnId: 'col_value', operator: 'gte', value: 10 }],
        orderBy: [{ columnId: 'col_value', direction: 'desc' }],
        limit: 20,
        offset: 40,
      },
      compilerDataset,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toBe(
      'SELECT "c0", "c1" FROM "dataset_test" WHERE ("c1" >= ?) ORDER BY "c1" DESC LIMIT 20 OFFSET 40',
    );
    expect(result.value.parameters).toEqual([10]);
  });

  test('always emits a bounded limit', () => {
    const result = compileAnalysisQuery(
      { datasetId: compilerDataset.id, dimensions: [], measures: [], filters: [] },
      compilerDataset,
    );
    expect(result.ok && result.value.sql.endsWith(`LIMIT ${DEFAULT_QUERY_LIMIT}`)).toBe(true);
  });

  test('compiles grouped aggregates', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: ['col_name'],
        measures: [{ columnId: 'col_value', aggregate: 'sum', alias: 'total' }],
        filters: [],
        orderBy: [{ measureAlias: 'total', direction: 'desc' }],
      },
      compilerDataset,
    );
    expect(result.ok && result.value.sql).toContain('SUM("c1") AS "m0"');
    // Grouped by SELECT position rather than by repeating the expression, which is what keeps a
    // parameterised dimension's placeholders and its bound values in step.
    expect(result.ok && result.value.sql).toContain('GROUP BY 1');
    expect(result.ok && result.value.sql).toContain('ORDER BY "m0" DESC');
  });

  /*
   * A binned dimension emits a placeholder in the SELECT list. Repeating the expression in GROUP BY
   * emitted a second placeholder while the parameter list still bound one value, so the statement
   * reached DuckDB with more placeholders than parameters and every temporally bucketed chart failed
   * to run. Grouping by position emits the expression exactly once.
   */
  test('a binned dimension binds exactly as many parameters as it emits placeholders', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: temporalDataset.id,
        dimensions: [],
        binnedDimensions: [{ columnId: 'col_date', strategy: { kind: 'temporal', unit: 'month' } }],
        measures: [{ columnId: 'col_value', aggregate: 'sum' }],
        filters: [],
      },
      temporalDataset,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    const placeholders = (result.value.sql.match(/\?/g) ?? []).length;

    expect(placeholders).toBe(result.value.parameters.length);
    expect(result.value.sql).toContain('GROUP BY 1');
    expect(result.value.parameters).toEqual(['month']);
  });

  test('a filtered binned query keeps dimension and filter parameters in order', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: temporalDataset.id,
        dimensions: [],
        binnedDimensions: [{ columnId: 'col_date', strategy: { kind: 'temporal', unit: 'week' } }],
        measures: [{ columnId: 'col_value', aggregate: 'sum' }],
        filters: [{ kind: 'comparison', columnId: 'col_value', operator: 'gte', value: 10 }],
      },
      temporalDataset,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    const placeholders = (result.value.sql.match(/\?/g) ?? []).length;

    expect(placeholders).toBe(result.value.parameters.length);
    // The dimension's unit binds before the filter's value, matching where each appears.
    expect(result.value.parameters).toEqual(['week', 10]);
  });
});
