import { describe, expect, test } from 'bun:test';
import {
  connectsDatasets,
  JOIN_KINDS,
  MAX_RELATIONSHIP_KEY_COLUMNS,
  relatedDatasetId,
  RELATIONSHIP_KINDS,
} from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';

const relationship: Relationship = {
  id: 'rel_1',
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_customers',
  on: [{ leftColumnId: 'col_customer', rightColumnId: 'col_id' }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
};

describe('relationship domain', () => {
  test('a new workspace starts with no relationships', () => {
    const workspace = createEmptyWorkspace();

    expect(Array.isArray(workspace.relationships)).toBe(false);
    expect(Object.keys(workspace.relationships)).toHaveLength(0);
  });

  test('only inner and left joins exist', () => {
    // The exclusion of right/full/cross is a correctness decision, not an oversight. Widening this
    // union must be a deliberate change that fails here first.
    expect([...JOIN_KINDS]).toEqual(['inner', 'left']);
  });

  test('the three cardinalities are declared exactly once each', () => {
    expect(new Set(RELATIONSHIP_KINDS).size).toBe(RELATIONSHIP_KINDS.length);
    expect([...RELATIONSHIP_KINDS].toSorted()).toEqual(['many_to_one', 'one_to_many', 'one_to_one']);
  });

  test('composite keys are bounded', () => {
    expect(MAX_RELATIONSHIP_KEY_COLUMNS).toBe(4);
  });
});

describe('relatedDatasetId', () => {
  test('resolves the other side from either end', () => {
    expect(relatedDatasetId(relationship, 'ds_orders')).toBe('ds_customers');
    expect(relatedDatasetId(relationship, 'ds_customers')).toBe('ds_orders');
  });

  test('returns undefined for a dataset the relationship does not touch', () => {
    expect(relatedDatasetId(relationship, 'ds_products')).toBeUndefined();
  });
});

describe('connectsDatasets', () => {
  test('matches the pair regardless of declared direction', () => {
    expect(connectsDatasets(relationship, 'ds_orders', 'ds_customers')).toBe(true);
    expect(connectsDatasets(relationship, 'ds_customers', 'ds_orders')).toBe(true);
  });

  test('does not match a partially overlapping pair', () => {
    expect(connectsDatasets(relationship, 'ds_orders', 'ds_products')).toBe(false);
  });
});
