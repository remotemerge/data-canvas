import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery, DEFAULT_QUERY_LIMIT, joinAlias } from '@/data/compiler/compile-analysis-query.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { customersDataset, ordersDataset, productsDataset } from '../application/action-fixtures.ts';

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
    if (!result.ok) {
      return;
    }

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
    if (!result.ok) {
      return;
    }

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
    if (!result.ok) {
      return;
    }
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

    if (!result.ok) {
      return;
    }

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

    if (!result.ok) {
      return;
    }

    const placeholders = (result.value.sql.match(/\?/g) ?? []).length;

    expect(placeholders).toBe(result.value.parameters.length);
    // The dimension's unit binds before the filter's value, matching where each appears.
    expect(result.value.parameters).toEqual(['week', 10]);
  });

  test('an ordered, offset page emits both clauses and one result column per output', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: ['col_name'],
        measures: [{ columnId: 'col_value', aggregate: 'sum', alias: 'total' }],
        filters: [],
        orderBy: [
          { measureAlias: 'total', direction: 'desc' },
          { columnId: 'col_name', direction: 'asc' },
        ],
        limit: 3,
        offset: 2,
      },
      compilerDataset,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sql).toContain('ORDER BY "m0" DESC, "c0" ASC');
    expect(result.value.sql).toContain('OFFSET 2');
    expect(result.value.resultColumns).toHaveLength(2);
    expect(result.value.joined).toBe(false);
  });
});

describe('compileAnalysisQuery refusals', () => {
  test('a query aimed at another dataset is refused', () => {
    const result = compileAnalysisQuery(
      { datasetId: 'ds_other', dimensions: [], measures: [], filters: [] },
      compilerDataset,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DATASET_NOT_FOUND');
    }
  });

  test('an unknown dimension is refused', () => {
    const result = compileAnalysisQuery(
      { datasetId: compilerDataset.id, dimensions: ['col_missing'], measures: [], filters: [] },
      compilerDataset,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  // Sorting by an alias no measure declares would silently order by nothing.
  test('a sort naming an alias the query never defines is refused', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: ['col_name'],
        measures: [{ columnId: 'col_value', aggregate: 'sum', alias: 'total' }],
        filters: [],
        orderBy: [{ measureAlias: 'missing', direction: 'asc' }],
      },
      compilerDataset,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });
});

describe('derived columns in a compiled query', () => {
  const margin: DerivedColumn = {
    id: 'derived_margin',
    datasetId: compilerDataset.id,
    name: 'Margin',
    expression: {
      kind: 'arithmetic',
      op: 'sub',
      left: { kind: 'column', columnId: 'col_value' },
      right: { kind: 'literal', value: 1 },
    },
    logicalType: 'number',
    typeVerified: true,
    createdBy: 'human',
  };

  // A derived reference is inlined in both roles, since SQL cannot group by a sibling select alias.
  test('inlines the definition as a dimension and again inside the aggregate', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: compilerDataset.id,
        dimensions: ['derived_margin'],
        measures: [{ columnId: 'derived_margin', aggregate: 'avg', alias: 'margin' }],
        filters: [],
      },
      { datasets: [compilerDataset], derivedColumns: { derived_margin: margin } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sql).toContain('AVG(("c1" - ?))');
    expect(result.value.sql).toContain('GROUP BY 1');
    expect(result.value.resultColumns[0]).toEqual({ key: 'derived_margin', name: 'Margin', logicalType: 'number' });
  });
});

describe('binned dimensions of every strategy', () => {
  test('compiles equal-width, fixed-width, explicit, quantile, and temporal bins in one query', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: temporalDataset.id,
        dimensions: [],
        binnedDimensions: [
          { columnId: 'col_value', strategy: { kind: 'equalWidth', binCount: 4 }, range: { min: 0, max: 100 } },
          { columnId: 'col_value', strategy: { kind: 'equalWidthOf', width: 5 }, range: { min: 0, max: 100 } },
          { columnId: 'col_value', strategy: { kind: 'explicit', breaks: [10, 20] } },
          { columnId: 'col_value', strategy: { kind: 'quantile', quantiles: 4 } },
          { columnId: 'col_date', strategy: { kind: 'temporal', unit: 'month' } },
        ],
        measures: [{ aggregate: 'count' }],
        filters: [],
      },
      temporalDataset,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sql).toContain('NTILE');
    expect(result.value.sql).toContain('GROUP BY 1, 2, 3, 4, 5');
    // A non-temporal bucket is a number regardless of the source column's type.
    expect(result.value.resultColumns[0]?.logicalType).toBe('number');
    expect(result.value.resultColumns[4]?.logicalType).toBe('date');
  });
});

describe('distribution queries', () => {
  test('emits the five-number summary a box plot consumes', () => {
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
    if (!result.ok) {
      return;
    }
    // The category leads the projection and the summary columns follow it.
    expect(result.value.resultColumns.map((column) => column.key)).toEqual(['col_name', 'q0', 'q1', 'q2', 'q3', 'q4']);
    expect(result.value.sql).toContain('quantile_cont');
    expect(result.value.sql).toContain('GROUP BY 1');
  });
});

describe('time comparison queries', () => {
  /*
   * A time comparison rewrites the whole statement into a date spine, so the base aggregate must
   * survive the measure loop. Compiling the modifier there instead fails before the spine is reached.
   */
  test('a time-comparison measure compiles to a gap-filled date spine', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: temporalDataset.id,
        dimensions: [],
        measures: [
          {
            columnId: 'col_value',
            aggregate: 'sum',
            alias: 'revenue',
            modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset: 1, as: 'difference' },
          },
        ],
        filters: [],
      },
      temporalDataset,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sql).toContain('WITH bucketed AS');
    expect(result.value.sql).toContain('date_trunc');
    expect(result.value.sql).toContain('SUM("c1")');
    expect(result.value.parameters).toEqual(['month', 1]);
    expect(result.value.resultColumns.map((column) => column.key)).toEqual(['d0', 'm0', 'm1']);
  });

  test('a rejected spine, such as an out-of-range offset, fails the whole query', () => {
    const result = compileAnalysisQuery(
      {
        datasetId: temporalDataset.id,
        dimensions: [],
        measures: [
          {
            columnId: 'col_value',
            aggregate: 'sum',
            modifier: { kind: 'timeComparison', dateColumnId: 'col_date', unit: 'month', offset: 0, as: 'absolute' },
          },
        ],
        filters: [],
      },
      temporalDataset,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RESULT_LIMIT_EXCEEDED');
    }
  });
});

describe('joined queries', () => {
  const orders = ordersDataset();
  const customers = customersDataset();
  const products = productsDataset();

  const relationships: Relationship[] = [
    {
      id: 'rel_orders_customers',
      leftDatasetId: orders.id,
      rightDatasetId: customers.id,
      on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
      kind: 'many_to_one',
      join: 'inner',
      createdBy: 'human',
    },
    {
      id: 'rel_orders_products',
      leftDatasetId: orders.id,
      rightDatasetId: products.id,
      on: [{ leftColumnId: 'col_order_id', rightColumnId: 'col_product_order' }],
      kind: 'one_to_many',
      join: 'left',
      createdBy: 'human',
    },
  ];

  const joinQuery: AnalysisQuery = {
    datasetId: orders.id,
    relationshipIds: relationships.map((relationship) => relationship.id),
    dimensions: ['col_customer_region', 'col_product_label'],
    measures: [{ columnId: 'col_order_revenue', aggregate: 'sum', alias: 'revenue' }],
    filters: [{ kind: 'comparison', columnId: 'col_customer_region', operator: 'eq', value: 'West' }],
    orderBy: [{ columnId: 'col_product_label', direction: 'asc' }],
    limit: 10,
  };

  test('aliases each relation and emits the join keyword the relationship declares', () => {
    const result = compileAnalysisQuery(joinQuery, { datasets: [orders, customers, products], relationships });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.joined).toBe(true);
    expect(result.value.sql).toContain(`AS "${joinAlias(0)}"`);
    expect(result.value.sql).toContain('INNER JOIN');
    expect(result.value.sql).toContain('LEFT JOIN');
    expect(result.value.datasetIds).toHaveLength(3);
  });

  // The hint may only reorder datasets the query already needs; it cannot add or drop a join.
  test('a join-order hint reorders the chain and ignores datasets the query does not read', () => {
    const hinted = compileAnalysisQuery(joinQuery, {
      datasets: [orders, customers, products],
      relationships,
      joinOrder: [products.id, customers.id, 'ds_irrelevant'],
    });

    expect(hinted.ok).toBe(true);
    if (!hinted.ok) {
      return;
    }
    expect(hinted.value.datasetIds).toEqual([orders.id, products.id, customers.id]);
  });

  /*
   * The path to the requested column runs through a dataset the workspace no longer holds, so the
   * chain cannot be aliased and the query is refused rather than compiled against a missing relation.
   */
  test('a join path crossing an absent bridge dataset is refused', () => {
    const throughMissingBridge: Relationship[] = [
      {
        id: 'rel_missing_bridge',
        leftDatasetId: orders.id,
        rightDatasetId: 'ds_missing_bridge',
        on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
        kind: 'many_to_one',
        join: 'inner',
        createdBy: 'human',
      },
      {
        id: 'rel_bridge_to_customers',
        leftDatasetId: 'ds_missing_bridge',
        rightDatasetId: customers.id,
        on: [{ leftColumnId: 'col_customer_id', rightColumnId: 'col_customer_id' }],
        kind: 'many_to_one',
        join: 'inner',
        createdBy: 'human',
      },
    ];

    const result = compileAnalysisQuery(
      { datasetId: orders.id, dimensions: ['col_customer_region'], measures: [], filters: [] },
      { datasets: [orders, customers], relationships: throughMissingBridge },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DATASET_NOT_FOUND');
    }
  });

  // A relationship with no key pairs would compile to a join predicate of nothing, a cross product.
  test('a relationship declaring no join keys is refused', () => {
    const noKeys: Relationship = {
      id: 'rel_empty_keys',
      leftDatasetId: orders.id,
      rightDatasetId: customers.id,
      on: [],
      kind: 'many_to_one',
      join: 'inner',
      createdBy: 'human',
    };

    const result = compileAnalysisQuery(
      {
        datasetId: orders.id,
        relationshipIds: [noKeys.id],
        dimensions: ['col_customer_region'],
        measures: [],
        filters: [],
      },
      { datasets: [orders, customers], relationships: [noKeys] },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
    }
  });
});

describe('join aliases', () => {
  test('are generated positionally, so no dataset name reaches the statement', () => {
    expect(joinAlias(0)).toBe('t0');
    expect(joinAlias(3)).toBe('t3');
  });
});
