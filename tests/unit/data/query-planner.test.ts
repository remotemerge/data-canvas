import { describe, expect, test } from 'bun:test';
import { partitionFilters, planQuery } from '@/data/compiler/query-planner.ts';
import type { PlannerContext } from '@/data/compiler/query-planner.ts';
import { orderJoinTargets } from '@/data/compiler/join-ordering.ts';
import { isFullWidthProjection, prunedProjection, referencedColumnIds } from '@/data/compiler/projection-pruning.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { CUSTOMERS_COLUMNS, ORDERS_COLUMNS, PRODUCTS_COLUMNS } from '../application/action-fixtures.ts';

const ordersToCustomers: Relationship = {
  id: 'rel_1' as EntityId,
  leftDatasetId: 'ds_orders' as EntityId,
  rightDatasetId: 'ds_customers' as EntityId,
  on: [{ leftColumnId: 'col_order_customer' as EntityId, rightColumnId: 'col_customer_id' as EntityId }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
};

const context = (...relationships: Relationship[]): PlannerContext => ({
  datasets: [
    { id: 'ds_orders' as EntityId, relationId: 'dataset_orders', columns: ORDERS_COLUMNS },
    { id: 'ds_customers' as EntityId, relationId: 'dataset_customers', columns: CUSTOMERS_COLUMNS },
    { id: 'ds_products' as EntityId, relationId: 'dataset_products', columns: PRODUCTS_COLUMNS },
  ],
  relationships,
});

const revenueByRegion: AnalysisQuery = {
  datasetId: 'ds_orders' as EntityId,
  dimensions: ['col_customer_region' as EntityId],
  measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
  filters: [],
};

describe('planner filter analysis', () => {
  test('marks an anchor-side filter pushable across an inner join', () => {
    const partition = partitionFilters(
      [{ kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 10 }],
      context(ordersToCustomers),
      'ds_orders' as EntityId,
    );

    expect(partition.pushable).toHaveLength(1);
    expect(partition.retained).toHaveLength(0);
  });

  test('retains a right-side filter across a left join', () => {
    // Pushing this below the join would turn matched rows into null-extended ones instead of
    // removing them, which changes the result.
    const partition = partitionFilters(
      [{ kind: 'comparison', columnId: 'col_customer_region' as EntityId, operator: 'eq', value: 'Europe' }],
      context({ ...ordersToCustomers, join: 'left' }),
      'ds_orders' as EntityId,
    );

    expect(partition.pushable).toHaveLength(0);
    expect(partition.retained).toHaveLength(1);
  });

  test('the anchor is never treated as null-extended', () => {
    const partition = partitionFilters(
      [{ kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 10 }],
      context({ ...ordersToCustomers, join: 'left' }),
      'ds_orders' as EntityId,
    );

    expect(partition.pushable).toHaveLength(1);
  });
});

describe('projection pruning', () => {
  test('recognizes a full-width projection', () => {
    expect(
      isFullWidthProjection({ datasetId: 'ds_orders' as EntityId, dimensions: [], measures: [], filters: [] }),
    ).toBe(true);
    expect(isFullWidthProjection(revenueByRegion)).toBe(false);
  });

  test('narrows a bare projection to the columns a filter names', () => {
    const query: AnalysisQuery = {
      datasetId: 'ds_orders' as EntityId,
      dimensions: [],
      measures: [],
      filters: [{ kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 10 }],
    };

    expect(prunedProjection(query, referencedColumnIds(query))).toEqual(['col_order_revenue' as EntityId]);
  });

  test('leaves a genuine show-everything projection alone', () => {
    // The table view asks for every column. Pruning it to nothing would return empty rows.
    const query: AnalysisQuery = { datasetId: 'ds_orders' as EntityId, dimensions: [], measures: [], filters: [] };

    expect(prunedProjection(query, referencedColumnIds(query))).toBeUndefined();
  });

  test('never prunes a query that already names its columns', () => {
    expect(prunedProjection(revenueByRegion, referencedColumnIds(revenueByRegion))).toBeUndefined();
  });

  // A distribution names its columns outside the dimension and measure channels.
  test('collects both the value and category columns of a distribution query', () => {
    expect(
      referencedColumnIds({
        datasetId: 'ds_orders' as EntityId,
        dimensions: [],
        binnedDimensions: [],
        measures: [],
        distribution: {
          columnId: 'col_order_revenue' as EntityId,
          categoryColumnId: 'col_customer_region' as EntityId,
        },
        filters: [],
      }),
    ).toEqual(['col_order_revenue' as EntityId, 'col_customer_region' as EntityId]);
  });

  // The derived ID stays because it is what the query names; its inputs are added so the join
  // resolver can reach the physical columns behind it.
  test('follows a derived reference to the physical columns it reads', () => {
    const margin: DerivedColumn = {
      id: 'col_margin' as EntityId,
      datasetId: 'ds_orders' as EntityId,
      name: 'Margin',
      expression: {
        kind: 'arithmetic',
        op: 'sub',
        left: { kind: 'column', columnId: 'col_order_revenue' as EntityId },
        right: { kind: 'column', columnId: 'col_order_id' as EntityId },
      },
      logicalType: 'number',
      typeVerified: true,
      createdBy: 'human',
    };
    const ids = referencedColumnIds(
      { datasetId: 'ds_orders' as EntityId, dimensions: ['col_margin' as EntityId], measures: [], filters: [] },
      { col_margin: margin },
    );

    expect(ids).toEqual(['col_margin' as EntityId, 'col_order_revenue' as EntityId, 'col_order_id' as EntityId]);
  });
});

describe('join ordering', () => {
  test('puts the smallest relation first', () => {
    const ordered = orderJoinTargets(
      ['ds_a' as EntityId, 'ds_b' as EntityId],
      [
        { datasetId: 'ds_a' as EntityId, rowCount: 1_000_000 },
        { datasetId: 'ds_b' as EntityId, rowCount: 500 },
      ],
    );

    expect(ordered).toEqual(['ds_b' as EntityId, 'ds_a' as EntityId]);
  });

  test('leaves a dataset with no estimate at the end rather than guessing', () => {
    const ordered = orderJoinTargets(
      ['ds_unknown' as EntityId, 'ds_small' as EntityId],
      [{ datasetId: 'ds_small' as EntityId, rowCount: 10 }],
    );

    expect(ordered).toEqual(['ds_small' as EntityId, 'ds_unknown' as EntityId]);
  });
});

describe('planQuery', () => {
  test('reports no optimization on a query with nothing to optimize', () => {
    const planned = planQuery(revenueByRegion, context(ordersToCustomers));

    expect(planned.applied).toEqual([]);
    expect(planned.query).toEqual(revenueByRegion);
  });

  test('reports pushdown when a filter is provably safe to push', () => {
    const planned = planQuery(
      {
        ...revenueByRegion,
        filters: [{ kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 10 }],
      },
      context(ordersToCustomers),
    );

    expect(planned.applied).toContain('filter-pushdown');
  });

  test('declines pushdown for a right-side filter across a left join', () => {
    const planned = planQuery(
      {
        ...revenueByRegion,
        filters: [{ kind: 'comparison', columnId: 'col_customer_region' as EntityId, operator: 'eq', value: 'Europe' }],
      },
      context({ ...ordersToCustomers, join: 'left' }),
    );

    expect(planned.applied).not.toContain('filter-pushdown');
  });

  test('records simplification only when the filters actually changed', () => {
    const unchanged = planQuery(revenueByRegion, context(ordersToCustomers));

    expect(unchanged.applied).not.toContain('filter-simplification');

    const redundant = planQuery(
      {
        ...revenueByRegion,
        filters: [
          {
            kind: 'and',
            operands: [
              { kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 10 },
              { kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 50 },
            ],
          },
        ],
      },
      context(ordersToCustomers),
    );

    expect(redundant.applied).toContain('filter-simplification');
    expect(redundant.query.filters[0]).toEqual({
      kind: 'comparison',
      columnId: 'col_order_revenue' as EntityId,
      operator: 'gt',
      value: 50,
    });
  });

  test('emits a join order hint only when cardinalities change the order', () => {
    const withoutStatistics = planQuery(revenueByRegion, context(ordersToCustomers));

    expect(withoutStatistics.joinOrder).toBeUndefined();
    expect(withoutStatistics.applied).not.toContain('join-ordering');
  });

  test('emits a join order hint when the estimates put the smaller relation first', () => {
    const ordersToProducts: Relationship = {
      id: 'rel_2' as EntityId,
      leftDatasetId: 'ds_orders' as EntityId,
      rightDatasetId: 'ds_products' as EntityId,
      on: [{ leftColumnId: 'col_order_id' as EntityId, rightColumnId: 'col_product_order' as EntityId }],
      kind: 'one_to_many',
      join: 'left',
      createdBy: 'human',
    };
    const planned = planQuery(
      {
        ...revenueByRegion,
        dimensions: ['col_customer_region' as EntityId, 'col_product_label' as EntityId],
      },
      {
        ...context(ordersToCustomers, ordersToProducts),
        cardinalities: [
          { datasetId: 'ds_customers' as EntityId, rowCount: 1_000 },
          { datasetId: 'ds_products' as EntityId, rowCount: 10 },
        ],
      },
    );

    expect(planned.applied).toContain('join-ordering');
    expect(planned.joinOrder).toEqual(['ds_products' as EntityId, 'ds_customers' as EntityId]);
  });

  // A bare projection with a filter both simplifies and narrows, so one pass can record two changes.
  test('records simplification and pruning together on a bare filtered projection', () => {
    const planned = planQuery(
      {
        datasetId: 'ds_orders' as EntityId,
        dimensions: [],
        measures: [],
        filters: [
          {
            kind: 'and',
            operands: [{ kind: 'comparison', columnId: 'col_customer_region' as EntityId, operator: 'eq', value: 'W' }],
          },
        ],
      },
      context(ordersToCustomers),
    );

    expect(planned.applied).toContain('filter-simplification');
    expect(planned.applied).toContain('projection-pruning');
    expect(planned.query.dimensions).toEqual(['col_customer_region' as EntityId]);
  });
});
