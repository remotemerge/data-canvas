import { describe, expect, test } from 'bun:test';
import {
  describeFanOutRisk,
  validateRelationship,
  wouldCreateCycle,
} from '@/application/validation/validate-relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { workspaceWithJoinableDatasets } from './action-fixtures.ts';

const ORDERS_TO_CUSTOMERS = {
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_customers',
  on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
  kind: 'many_to_one' as const,
};

const relate = (id: string, left: string, right: string): Relationship => ({
  id,
  leftDatasetId: left,
  rightDatasetId: right,
  on: [{ leftColumnId: 'col_a', rightColumnId: 'col_b' }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
});

const withRelationships = (...relationships: Relationship[]): Workspace => ({
  ...workspaceWithJoinableDatasets(),
  relationships: Object.fromEntries(relationships.map((relationship) => [relationship.id, relationship])),
});

describe('validateRelationship', () => {
  test('accepts type-compatible key columns', () => {
    const result = validateRelationship(workspaceWithJoinableDatasets(), ORDERS_TO_CUSTOMERS);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.keys).toHaveLength(1);
    expect(result.value.keys[0]?.left.id).toBe('col_order_customer');
    expect(result.value.keys[0]?.right.id).toBe('col_customer_id');
  });

  test('rejects mismatched logical types with INCOMPATIBLE_COLUMN', () => {
    const result = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      // A numeric key against a text key.
      on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_name' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });

  test('treats string and category as the same key class', () => {
    // Category is a string refinement, so it remains compatible with text keys.
    const result = validateRelationship(workspaceWithJoinableDatasets(), {
      leftDatasetId: 'ds_customers',
      rightDatasetId: 'ds_products',
      on: [{ leftColumnId: 'col_customer_region', rightColumnId: 'col_product_label' }],
      kind: 'many_to_one',
    });

    expect(result.ok).toBe(true);
  });

  test('rejects a self-join', () => {
    const result = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      rightDatasetId: 'ds_orders',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects an unknown dataset and an unknown column', () => {
    const missingDataset = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      rightDatasetId: 'ds_nope',
    });
    expect(missingDataset.ok === false && missingDataset.error.code).toBe('DATASET_NOT_FOUND');

    const missingColumn = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      on: [{ leftColumnId: 'col_nope', rightColumnId: 'col_customer_id' }],
    });
    expect(missingColumn.ok === false && missingColumn.error.code).toBe('COLUMN_NOT_FOUND');
  });

  test('an unknown left dataset is reported the same way as an unknown right one', () => {
    const result = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      leftDatasetId: 'ds_nope',
    });

    expect(result.ok === false && result.error.code).toBe('DATASET_NOT_FOUND');
  });

  test('an unknown column on the right side is reported the same way as on the left', () => {
    const result = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_nope' }],
    });

    expect(result.ok === false && result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  test('a temporal key against a numeric key is refused', () => {
    const result = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      on: [{ leftColumnId: 'col_order_placed', rightColumnId: 'col_customer_id' }],
    });

    expect(result.ok === false && result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });

  test('rejects a duplicate relationship declared in the same direction', () => {
    const workspace = withRelationships(relate('rel_1', 'ds_orders', 'ds_customers'));
    const result = validateRelationship(workspace, ORDERS_TO_CUSTOMERS);

    expect(result.ok === false && result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('a left dataset that is not ready is refused alongside the right one', () => {
    const workspace = workspaceWithJoinableDatasets();
    const orders = workspace.datasets['ds_orders'];
    if (orders === undefined) {
      throw new Error('fixture missing orders');
    }

    const result = validateRelationship(
      { ...workspace, datasets: { ...workspace.datasets, ds_orders: { ...orders, importStatus: 'loading' } } },
      ORDERS_TO_CUSTOMERS,
    );

    expect(result.ok === false && result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects a duplicate relationship over the same pair in either direction', () => {
    const workspace = withRelationships(relate('rel_1', 'ds_customers', 'ds_orders'));
    const result = validateRelationship(workspace, ORDERS_TO_CUSTOMERS);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
    expect(result.error.message).toContain('already related');
  });

  test('rejects a cycle with RELATIONSHIP_CYCLE', () => {
    // The third edge would close the orders-customers-products loop.
    const workspace = withRelationships(
      relate('rel_1', 'ds_orders', 'ds_customers'),
      relate('rel_2', 'ds_customers', 'ds_products'),
    );

    const result = validateRelationship(workspace, {
      leftDatasetId: 'ds_products',
      rightDatasetId: 'ds_orders',
      on: [{ leftColumnId: 'col_product_order', rightColumnId: 'col_order_id' }],
      kind: 'many_to_one',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('RELATIONSHIP_CYCLE');
  });

  test('rejects an empty or oversized key', () => {
    const empty = validateRelationship(workspaceWithJoinableDatasets(), { ...ORDERS_TO_CUSTOMERS, on: [] });
    expect(empty.ok === false && empty.error.code).toBe('INVALID_TOOL_ARGUMENTS');

    const oversized = validateRelationship(workspaceWithJoinableDatasets(), {
      ...ORDERS_TO_CUSTOMERS,
      on: Array.from({ length: 5 }, () => ({
        leftColumnId: 'col_order_customer',
        rightColumnId: 'col_customer_id',
      })),
    });
    expect(oversized.ok === false && oversized.error.code).toBe('INVALID_TOOL_ARGUMENTS');
  });

  test('rejects a dataset that is not ready', () => {
    const workspace = workspaceWithJoinableDatasets();
    const loading = { ...workspace, datasets: { ...workspace.datasets } };
    const customers = loading.datasets['ds_customers'];
    if (customers === undefined) {
      throw new Error('fixture missing customers');
    }
    loading.datasets['ds_customers'] = { ...customers, importStatus: 'loading' };

    const result = validateRelationship(loading, ORDERS_TO_CUSTOMERS);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });
});

describe('wouldCreateCycle', () => {
  test('detects a closing edge across a chain', () => {
    const chain = [relate('rel_1', 'ds_orders', 'ds_customers'), relate('rel_2', 'ds_customers', 'ds_products')];

    expect(wouldCreateCycle(chain, 'ds_products', 'ds_orders')).toBe(true);
  });

  test('allows an edge to an unconnected dataset', () => {
    expect(wouldCreateCycle([relate('rel_1', 'ds_orders', 'ds_customers')], 'ds_customers', 'ds_products')).toBe(false);
  });

  test('an empty graph never closes a cycle', () => {
    expect(wouldCreateCycle([], 'ds_orders', 'ds_customers')).toBe(false);
  });
});

describe('describeFanOutRisk', () => {
  test('warns when a many_to_one right key is not unique', () => {
    const warning = describeFanOutRisk('many_to_one', { rowsPerKey: 1.4, sampledRows: 1400, distinctKeys: 1000 });

    expect(warning).toBeDefined();
    // The measurement must be stated, not merely asserted, so the user can judge it.
    expect(warning).toContain('1.40');
  });

  test('warns for one_to_one on a duplicated key', () => {
    expect(describeFanOutRisk('one_to_one', { rowsPerKey: 2, sampledRows: 200, distinctKeys: 100 })).toBeDefined();
  });

  test('stays silent when the right key is unique', () => {
    expect(describeFanOutRisk('many_to_one', { rowsPerKey: 1, sampledRows: 1000, distinctKeys: 1000 })).toBeUndefined();
  });

  test('one_to_many makes no uniqueness claim, so it never warns', () => {
    expect(describeFanOutRisk('one_to_many', { rowsPerKey: 5, sampledRows: 500, distinctKeys: 100 })).toBeUndefined();
  });

  test('an empty sample produces no warning', () => {
    expect(describeFanOutRisk('many_to_one', { rowsPerKey: 0, sampledRows: 0, distinctKeys: 0 })).toBeUndefined();
  });
});
