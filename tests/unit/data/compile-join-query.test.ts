import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery } from '@/data/compiler/compile-analysis-query.ts';
import type { QueryContext } from '@/data/compiler/compile-analysis-query.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { CUSTOMERS_COLUMNS, ORDERS_COLUMNS, PRODUCTS_COLUMNS } from '../application/action-fixtures.ts';

const ordersToCustomers: Relationship = {
  id: 'rel_1',
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_customers',
  on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
};

const context = (...relationships: Relationship[]): QueryContext => ({
  datasets: [
    { id: 'ds_orders', relationId: 'dataset_orders', columns: ORDERS_COLUMNS },
    { id: 'ds_customers', relationId: 'dataset_customers', columns: CUSTOMERS_COLUMNS },
    { id: 'ds_products', relationId: 'dataset_products', columns: PRODUCTS_COLUMNS },
  ],
  relationships,
});

/** Revenue by customer region: a measure from one dataset grouped by a dimension from another. */
const revenueByRegion = {
  datasetId: 'ds_orders',
  dimensions: ['col_customer_region'],
  measures: [{ columnId: 'col_order_revenue', aggregate: 'sum' as const, alias: 'total' }],
  filters: [],
};

describe('join compilation', () => {
  test('a query that stays on its anchor compiles without aliases, unchanged from before joins', () => {
    const result = compileAnalysisQuery(
      { datasetId: 'ds_orders', dimensions: [], measures: [], filters: [] },
      context(ordersToCustomers),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toContain('FROM "dataset_orders"');
    expect(result.value.sql).not.toContain('JOIN');
    expect(result.value.sql).not.toContain('"t0"');
    expect(result.value.joined).toBe(false);
  });

  test('aggregates a measure from one dataset by a dimension from another', () => {
    const result = compileAnalysisQuery(revenueByRegion, context(ordersToCustomers));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toBe(
      'SELECT "t1"."region", SUM("t0"."revenue") AS "m0" FROM "dataset_orders" AS "t0" ' +
        'INNER JOIN "dataset_customers" AS "t1" ON "t0"."customer_id" = "t1"."id" ' +
        'GROUP BY 1 LIMIT 500',
    );
    expect(result.value.joined).toBe(true);
    expect(result.value.datasetIds).toEqual(['ds_orders', 'ds_customers']);
  });

  test('a left join preserves the anchor rows; an inner join does not', () => {
    const inner = compileAnalysisQuery(revenueByRegion, context(ordersToCustomers));
    const left = compileAnalysisQuery(revenueByRegion, context({ ...ordersToCustomers, join: 'left' }));

    expect(inner.ok && inner.value.sql).toContain('INNER JOIN "dataset_customers"');
    expect(left.ok && left.value.sql).toContain('LEFT JOIN "dataset_customers"');
  });

  test('LEFT is emitted relative to traversal direction, not the stored left/right fields', () => {
    // Anchored on the relationship's right side. A left join must still preserve the rows already
    // in the chain — the anchor — rather than flipping meaning with the declaration order.
    const result = compileAnalysisQuery(
      {
        datasetId: 'ds_customers',
        dimensions: ['col_customer_region'],
        measures: [{ columnId: 'col_order_revenue', aggregate: 'sum' }],
        filters: [],
      },
      context({ ...ordersToCustomers, join: 'left' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toContain('FROM "dataset_customers" AS "t0"');
    expect(result.value.sql).toContain('LEFT JOIN "dataset_orders" AS "t1"');
  });

  test('filters apply to columns on either side of the join and stay parameterized', () => {
    const result = compileAnalysisQuery(
      {
        ...revenueByRegion,
        filters: [
          { kind: 'comparison', columnId: 'col_order_revenue', operator: 'gt', value: 100 },
          { kind: 'comparison', columnId: 'col_customer_region', operator: 'eq', value: 'Europe' },
        ],
      },
      context(ordersToCustomers),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toContain('("t0"."revenue" > ?)');
    expect(result.value.sql).toContain('("t1"."region" = ?)');
    expect(result.value.parameters).toEqual([100, 'Europe']);
    expect(result.value.sql).not.toContain('Europe');
  });

  test('sorting by a joined column is table-qualified', () => {
    const result = compileAnalysisQuery(
      { ...revenueByRegion, orderBy: [{ columnId: 'col_customer_region', direction: 'asc' }] },
      context(ordersToCustomers),
    );

    expect(result.ok && result.value.sql).toContain('ORDER BY "t1"."region" ASC');
  });

  test('a multi-hop join chains each step from a dataset already in the query', () => {
    const customersToProducts: Relationship = {
      id: 'rel_2',
      leftDatasetId: 'ds_customers',
      rightDatasetId: 'ds_products',
      on: [{ leftColumnId: 'col_customer_id', rightColumnId: 'col_product_id' }],
      kind: 'one_to_many',
      join: 'left',
      createdBy: 'human',
    };

    const result = compileAnalysisQuery(
      {
        datasetId: 'ds_orders',
        dimensions: ['col_product_label'],
        measures: [{ columnId: 'col_order_revenue', aggregate: 'sum' }],
        filters: [],
      },
      context(ordersToCustomers, customersToProducts),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).toContain('FROM "dataset_orders" AS "t0"');
    expect(result.value.sql).toContain('INNER JOIN "dataset_customers" AS "t1" ON "t0"."customer_id" = "t1"."id"');
    expect(result.value.sql).toContain('LEFT JOIN "dataset_products" AS "t2" ON "t1"."id" = "t2"."id"');
  });

  test('a composite key emits one equality per pair, all conjoined', () => {
    const composite: Relationship = {
      ...ordersToCustomers,
      on: [
        { leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' },
        { leftColumnId: 'col_order_id', rightColumnId: 'col_customer_id' },
      ],
    };

    const result = compileAnalysisQuery(revenueByRegion, context(composite));

    expect(result.ok && result.value.sql).toContain(
      'ON "t0"."customer_id" = "t1"."id" AND "t0"."order_id" = "t1"."id"',
    );
  });

  test('an unreachable column fails with NO_JOIN_PATH rather than compiling', () => {
    const result = compileAnalysisQuery(revenueByRegion, context());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_JOIN_PATH');
  });

  test('a bare projection returns the anchor columns only, not the joined ones', () => {
    // Widening a `SELECT *` across a join would return whatever the join reached, which no caller
    // asked for and which would silently change the table view's shape.
    const result = compileAnalysisQuery(
      {
        datasetId: 'ds_orders',
        dimensions: [],
        measures: [],
        filters: [{ kind: 'comparison', columnId: 'col_customer_region', operator: 'eq', value: 'Europe' }],
      },
      context(ordersToCustomers),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resultColumns.map((column) => column.key)).toEqual(ORDERS_COLUMNS.map((column) => column.id));
  });
});

describe('join injection boundaries', () => {
  test('every identifier in a joined query is quoted and generated', () => {
    const result = compileAnalysisQuery(revenueByRegion, context(ordersToCustomers));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Aliases are compiler-generated (`t0`, `t1`), never derived from a dataset or column name.
    const aliases = [...result.value.sql.matchAll(/AS "(t\d+)"/gu)].map(([, alias]) => alias);
    expect(aliases).toEqual(['t0', 't1']);

    // Nothing outside the quoted-identifier and placeholder vocabulary reaches the SQL.
    for (const identifier of [...result.value.sql.matchAll(/"([^"]+)"/gu)].map(([, name]) => name ?? '')) {
      expect(identifier).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
  });

  test('a hostile display name on a joined dataset never reaches the SQL', () => {
    const hostile = '"; DROP TABLE data; --';
    const poisoned = context(ordersToCustomers);
    const customers = poisoned.datasets[1];
    if (customers === undefined) throw new Error('fixture missing customers');

    const result = compileAnalysisQuery(revenueByRegion, {
      ...poisoned,
      datasets: [
        poisoned.datasets[0] as (typeof poisoned.datasets)[number],
        {
          ...customers,
          columns: customers.columns.map((column) =>
            column.id === 'col_customer_region' ? { ...column, name: hostile } : column,
          ),
        },
        poisoned.datasets[2] as (typeof poisoned.datasets)[number],
      ],
    });

    expect(result.ok && result.value.sql).not.toContain(hostile);
  });

  test('a hostile filter value across a join stays a bound parameter', () => {
    const hostile = "x'); DELETE FROM data; --";
    const result = compileAnalysisQuery(
      {
        ...revenueByRegion,
        filters: [{ kind: 'comparison', columnId: 'col_customer_region', operator: 'eq', value: hostile }],
      },
      context(ordersToCustomers),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sql).not.toContain(hostile);
    expect(result.value.parameters).toContain(hostile);
  });
});
