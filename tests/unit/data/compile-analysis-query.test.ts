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

// Compiler dataset plus a temporal column for binning tests.
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

describe('quantile binning', () => {
  /*
   * `NTILE` is a window function, so SQL forbids both grouping by it directly and mixing it with an
   * aggregate at the same level. The bucket is computed per row in a subquery and grouped outside.
   */
  test('groups by a quantile bucket computed in a subquery', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: 'ds_test',
        dimensions: [],
        binnedDimensions: [{ columnId: 'col_value', strategy: { kind: 'quantile', quantiles: 4 } }],
        measures: [{ aggregate: 'count' }],
        filters: [],
      },
      compilerDataset,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The window function is evaluated in the subquery, never in GROUP BY.
    expect(result.value.sql).toContain('NTILE(?) OVER');
    expect(result.value.sql).toMatch(/FROM \(SELECT \*, NTILE/u);
    expect(result.value.sql).toContain('GROUP BY');
    expect(result.value.sql.split('GROUP BY')[1]).not.toContain('NTILE');
    expect(result.value.parameters).toEqual([4]);
  });

  test('applies filters inside the subquery so buckets cover only matching rows', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: 'ds_test',
        dimensions: [],
        binnedDimensions: [{ columnId: 'col_value', strategy: { kind: 'quantile', quantiles: 4 } }],
        measures: [{ aggregate: 'count' }],
        filters: [{ kind: 'comparison', columnId: 'col_value', operator: 'gt', value: 10 }],
      },
      compilerDataset,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /*
     * The filter belongs to the subquery: a WHERE applied after bucketing would rank unfiltered rows
     * and then discard some, so the surviving buckets would hold uneven shares of the filtered set.
     */
    const subqueryEnd = result.value.sql.lastIndexOf(')');
    const outer = result.value.sql.slice(subqueryEnd);

    expect(result.value.sql.slice(0, subqueryEnd)).toContain('WHERE');
    expect(outer).not.toContain('WHERE');
    expect(outer).toContain('GROUP BY');
    // Bucket count binds before the filter value, matching the emitted order.
    expect(result.value.parameters).toEqual([4, 10]);
  });
});

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
    // Group by SELECT position so parameter binding stays aligned.
    expect(result.ok && result.value.sql).toContain('GROUP BY 1');
    expect(result.ok && result.value.sql).toContain('ORDER BY "m0" DESC');
  });

  // Grouping by position emits the binned expression once.
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
