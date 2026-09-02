import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery } from '@/data/compiler/compile-analysis-query.ts';
import type { QueryContext } from '@/data/compiler/compile-analysis-query.ts';
import { planQuery } from '@/data/compiler/query-planner.ts';
import type { PlannerContext } from '@/data/compiler/query-planner.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { CUSTOMERS_COLUMNS, ORDERS_COLUMNS, PRODUCTS_COLUMNS } from '../application/action-fixtures.ts';

// Verifies that planned queries preserve query semantics.

const ordersToCustomers: Relationship = {
  id: 'rel_1' as EntityId,
  leftDatasetId: 'ds_orders' as EntityId,
  rightDatasetId: 'ds_customers' as EntityId,
  on: [{ leftColumnId: 'col_order_customer' as EntityId, rightColumnId: 'col_customer_id' as EntityId }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
};

const customersToProducts: Relationship = {
  id: 'rel_2' as EntityId,
  leftDatasetId: 'ds_customers' as EntityId,
  rightDatasetId: 'ds_products' as EntityId,
  on: [{ leftColumnId: 'col_customer_id' as EntityId, rightColumnId: 'col_product_id' as EntityId }],
  kind: 'one_to_many',
  join: 'left',
  createdBy: 'human',
};

const datasets = [
  { id: 'ds_orders' as EntityId, relationId: 'dataset_orders', columns: ORDERS_COLUMNS },
  { id: 'ds_customers' as EntityId, relationId: 'dataset_customers', columns: CUSTOMERS_COLUMNS },
  { id: 'ds_products' as EntityId, relationId: 'dataset_products', columns: PRODUCTS_COLUMNS },
];

const plannerContext = (...relationships: Relationship[]): PlannerContext => ({ datasets, relationships });

const compilerContext = (...relationships: Relationship[]): QueryContext => ({ datasets, relationships });

// Compiles a query with and without the planning pass.
const bothForms = (query: AnalysisQuery, ...relationships: Relationship[]) => {
  const unplanned = compileAnalysisQuery(query, compilerContext(...relationships));
  const planned = planQuery(query, plannerContext(...relationships));
  const compiled = compileAnalysisQuery(planned.query, {
    ...compilerContext(...relationships),
    ...(planned.joinOrder === undefined ? {} : { joinOrder: planned.joinOrder }),
  });

  return { unplanned, compiled, applied: planned.applied };
};

const FIXTURES: { name: string; query: AnalysisQuery; relationships: Relationship[] }[] = [
  {
    name: 'single-dataset aggregate',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_order_id' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [],
    },
    relationships: [],
  },
  {
    name: 'inner-join aggregate',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_customer_region' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [],
    },
    relationships: [ordersToCustomers],
  },
  {
    name: 'inner join with an anchor-side filter',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_customer_region' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [{ kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 100 }],
    },
    relationships: [ordersToCustomers],
  },
  {
    name: 'left join with a right-side filter',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_customer_region' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [{ kind: 'comparison', columnId: 'col_customer_region' as EntityId, operator: 'eq', value: 'Europe' }],
    },
    relationships: [{ ...ordersToCustomers, join: 'left' }],
  },
  {
    name: 'multi-hop join',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_product_label' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [],
    },
    relationships: [ordersToCustomers, customersToProducts],
  },
  {
    name: 'sorted and limited aggregate',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_customer_region' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [],
      orderBy: [{ measureAlias: 'total', direction: 'desc' }],
      limit: 25,
    },
    relationships: [ordersToCustomers],
  },
  {
    name: 'binned dimension',
    query: {
      datasetId: 'ds_orders' as EntityId,
      dimensions: [],
      binnedDimensions: [
        {
          columnId: 'col_order_revenue' as EntityId,
          strategy: { kind: 'equalWidth', binCount: 10 },
          range: { min: 0, max: 100 },
        },
      ],
      measures: [{ aggregate: 'count', alias: 'rows' }],
      filters: [],
    },
    relationships: [],
  },
];

describe('planner equivalence', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.name} compiles identically with and without planning`, () => {
      const { unplanned, compiled } = bothForms(fixture.query, ...fixture.relationships);

      expect(unplanned.ok).toBe(true);
      expect(compiled.ok).toBe(true);
      if (!unplanned.ok || !compiled.ok) {
        return;
      }

      expect(compiled.value.sql).toBe(unplanned.value.sql);
      expect(compiled.value.parameters).toEqual(unplanned.value.parameters);
      expect(compiled.value.resultColumns).toEqual(unplanned.value.resultColumns);
      expect(compiled.value.datasetIds).toEqual(unplanned.value.datasetIds);
    });
  }

  test('a right-side filter across a left join is never pushed, so the statement is unchanged', () => {
    const query = FIXTURES.find((fixture) => fixture.name === 'left join with a right-side filter');

    if (query === undefined) {
      throw new Error('fixture missing');
    }

    const { unplanned, compiled, applied } = bothForms(query.query, ...query.relationships);

    expect(applied).not.toContain('filter-pushdown');
    expect(unplanned.ok && compiled.ok && compiled.value.sql).toBe(unplanned.ok ? unplanned.value.sql : '');
  });

  test('predicate simplification preserves the rows a redundant range selects', () => {
    // Keep only the tighter bound while preserving the selected rows.
    const query: AnalysisQuery = {
      datasetId: 'ds_orders' as EntityId,
      dimensions: [],
      measures: [{ aggregate: 'count', alias: 'rows' }],
      filters: [
        {
          kind: 'and',
          operands: [
            { kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 10 },
            { kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 50 },
          ],
        },
      ],
    };

    const { compiled, applied } = bothForms(query);

    expect(applied).toContain('filter-simplification');
    expect(compiled.ok && compiled.value.parameters).toEqual([50]);
  });

  test('projection pruning narrows the SELECT list without changing which rows match', () => {
    const query: AnalysisQuery = {
      datasetId: 'ds_orders' as EntityId,
      dimensions: [],
      measures: [],
      filters: [{ kind: 'comparison', columnId: 'col_order_revenue' as EntityId, operator: 'gt', value: 100 }],
    };

    const { unplanned, compiled, applied } = bothForms(query);

    expect(applied).toContain('projection-pruning');
    expect(unplanned.ok && compiled.ok).toBe(true);
    if (!unplanned.ok || !compiled.ok) {
      return;
    }

    // Pruning changes selected columns, not filters.
    expect(compiled.value.resultColumns.length).toBeLessThan(unplanned.value.resultColumns.length);
    expect(compiled.value.parameters).toEqual(unplanned.value.parameters);
    expect(compiled.value.sql).toContain('WHERE ("revenue" > ?)');
  });

  test('a join order hint cannot introduce a dataset the query never referenced', () => {
    const query: AnalysisQuery = {
      datasetId: 'ds_orders' as EntityId,
      dimensions: ['col_customer_region' as EntityId],
      measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
      filters: [],
    };

    const hinted = compileAnalysisQuery(query, {
      ...compilerContext(ordersToCustomers, customersToProducts),
      joinOrder: ['ds_products' as EntityId],
    });
    const plain = compileAnalysisQuery(query, compilerContext(ordersToCustomers, customersToProducts));

    expect(hinted.ok && plain.ok).toBe(true);
    if (!hinted.ok || !plain.ok) {
      return;
    }
    expect(hinted.value.sql).toBe(plain.value.sql);
    expect(hinted.value.datasetIds).not.toContain('ds_products' as EntityId);
  });
});
