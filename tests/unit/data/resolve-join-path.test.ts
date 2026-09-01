import { describe, expect, test } from 'bun:test';
import type { QueryDataset } from '@/data/compiler/compile-analysis-query.ts';
import { datasetIdsForColumns, resolveJoinPath } from '@/data/compiler/resolve-join-path.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { CUSTOMERS_COLUMNS, ORDERS_COLUMNS, PRODUCTS_COLUMNS } from '../application/action-fixtures.ts';

const datasets: QueryDataset[] = [
  { id: 'ds_orders', relationId: 'dataset_orders', columns: ORDERS_COLUMNS },
  { id: 'ds_customers', relationId: 'dataset_customers', columns: CUSTOMERS_COLUMNS },
  { id: 'ds_products', relationId: 'dataset_products', columns: PRODUCTS_COLUMNS },
];

const relate = (id: string, left: string, right: string): Relationship => ({
  id,
  leftDatasetId: left,
  rightDatasetId: right,
  on: [{ leftColumnId: 'col_a', rightColumnId: 'col_b' }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
});

const CHAIN = [relate('rel_1', 'ds_orders', 'ds_customers'), relate('rel_2', 'ds_customers', 'ds_products')];

describe('resolveJoinPath', () => {
  test('an anchor-only query needs no joins', () => {
    const result = resolveJoinPath('ds_orders', ['ds_orders'], CHAIN);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.steps).toHaveLength(0);
    expect(result.value.datasetIds).toEqual(['ds_orders']);
  });

  test('resolves a direct join', () => {
    const result = resolveJoinPath('ds_orders', ['ds_customers'], CHAIN);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.steps).toHaveLength(1);
    expect(result.value.steps[0]?.relationship.id).toBe('rel_1');
    expect(result.value.datasetIds).toEqual(['ds_orders', 'ds_customers']);
  });

  test('traverses a multi-hop chain in order', () => {
    const result = resolveJoinPath('ds_orders', ['ds_products'], CHAIN);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Each step must join from a dataset already in the chain.
    expect(result.value.steps.map((step) => step.toDatasetId)).toEqual(['ds_customers', 'ds_products']);
    expect(result.value.steps[0]?.fromDatasetId).toBe('ds_orders');
    expect(result.value.steps[1]?.fromDatasetId).toBe('ds_customers');
  });

  test('traverses a relationship declared in the opposite direction', () => {
    // Reachability must not depend on the declared relationship side.
    const result = resolveJoinPath('ds_customers', ['ds_orders'], [relate('rel_1', 'ds_orders', 'ds_customers')]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.steps[0]?.fromDatasetId).toBe('ds_customers');
    expect(result.value.steps[0]?.toDatasetId).toBe('ds_orders');
  });

  test('joins a shared intermediate dataset only once', () => {
    const result = resolveJoinPath('ds_orders', ['ds_customers', 'ds_products'], CHAIN);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.datasetIds).toEqual(['ds_orders', 'ds_customers', 'ds_products']);
    expect(result.value.steps).toHaveLength(2);
  });

  test('fails with NO_JOIN_PATH naming the unreachable dataset', () => {
    const result = resolveJoinPath('ds_orders', ['ds_products'], [relate('rel_1', 'ds_orders', 'ds_customers')]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NO_JOIN_PATH');
    expect(result.error.message).toContain('ds_products');
    // The message must help correct the request.
    expect(result.error.message).toContain('Create a relationship');
  });

  test('an explicit relationship list constrains the reachable path', () => {
    const result = resolveJoinPath('ds_orders', ['ds_products'], CHAIN, ['rel_1']);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NO_JOIN_PATH');
  });

  test('an unknown relationship id is reported rather than ignored', () => {
    const result = resolveJoinPath('ds_orders', ['ds_customers'], CHAIN, ['rel_missing']);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('NO_JOIN_PATH');
    expect(result.error.message).toContain('rel_missing');
  });
});

describe('datasetIdsForColumns', () => {
  test('maps columns to their owning datasets without duplicates', () => {
    expect(datasetIdsForColumns(['col_order_revenue', 'col_customer_region', 'col_order_id'], datasets)).toEqual([
      'ds_orders',
      'ds_customers',
    ]);
  });

  test('omits a column belonging to no dataset, leaving the compiler to report it', () => {
    expect(datasetIdsForColumns(['col_unknown'], datasets)).toEqual([]);
  });
});
