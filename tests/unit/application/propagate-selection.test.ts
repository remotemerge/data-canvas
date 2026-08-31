import { describe, expect, test } from 'bun:test';
import { propagateSelection } from '@/application/selection/propagate-selection.ts';
import { isWithinSelectionScope, propagationPath } from '@/application/selection/selection-scope.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { workspaceWithJoinableDatasets } from './action-fixtures.ts';

const ORDERS = 'ds_orders';
const CUSTOMERS = 'ds_customers';
const PRODUCTS = 'ds_products';

// Links orders to customers, leaving products unrelated to either.
const withRelationship = (workspace: Workspace): Workspace => ({
  ...workspace,
  relationships: {
    rel_orders_customers: {
      id: 'rel_orders_customers',
      leftDatasetId: ORDERS,
      rightDatasetId: CUSTOMERS,
      on: [{ leftColumnId: 'col_customer_id', rightColumnId: 'col_id' }],
      kind: 'many_to_one',
      join: 'inner',
      createdBy: 'human',
    },
  },
});

const selectionOn = (datasetId: string): Selection => ({
  id: 'sel_1',
  datasetId,
  mode: 'predicate',
  predicate: { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'EU' },
  origin: 'chart',
});

const chartOn = (datasetId: string, linkMode: Visualization['linkMode'] = 'highlight'): Visualization => ({
  id: 'viz_1',
  datasetId,
  title: 'Chart',
  kind: 'bar',
  query: { datasetId, dimensions: [], measures: [], filters: [] },
  binding: {},
  presentation: { showLegend: true, showGrid: true, stacked: false },
  linkMode,
  createdBy: 'human',
});

const workspaceWith = (selection: Selection): Workspace => ({
  ...withRelationship(workspaceWithJoinableDatasets()),
  selections: { [selection.id]: selection },
});

describe('selection scope', () => {
  test('finds an empty path from a dataset to itself', () =>
    expect(propagationPath(withRelationship(workspaceWithJoinableDatasets()), ORDERS, ORDERS)).toEqual([]));

  test('finds a path across a declared relationship', () => {
    const path = propagationPath(withRelationship(workspaceWithJoinableDatasets()), ORDERS, CUSTOMERS);
    expect(path).toHaveLength(1);
    expect(path?.[0]?.id).toBe('rel_orders_customers');
  });

  test('traverses a relationship in either direction', () =>
    expect(propagationPath(withRelationship(workspaceWithJoinableDatasets()), CUSTOMERS, ORDERS)).toHaveLength(1));

  test('finds no path to an unrelated dataset', () => {
    const workspace = withRelationship(workspaceWithJoinableDatasets());
    expect(propagationPath(workspace, ORDERS, PRODUCTS)).toBeUndefined();
    expect(isWithinSelectionScope(workspace, ORDERS, PRODUCTS)).toBe(false);
  });

  test('finds no path when no relationship exists at all', () =>
    expect(propagationPath(workspaceWithJoinableDatasets(), ORDERS, CUSTOMERS)).toBeUndefined());
});

describe('selection propagation', () => {
  test('applies a selection to a chart on its own dataset', () => {
    const result = propagateSelection(workspaceWith(selectionOn(ORDERS)), chartOn(ORDERS));
    expect(result.effect).toBe('highlight');
    expect(result.predicate).toBeDefined();
  });

  test('propagates across a relationship', () => {
    const result = propagateSelection(workspaceWith(selectionOn(ORDERS)), chartOn(CUSTOMERS));
    expect(result.effect).toBe('highlight');
    expect(result.predicate).toBeDefined();
  });

  test('does not propagate to an unrelated dataset', () => {
    const result = propagateSelection(workspaceWith(selectionOn(ORDERS)), chartOn(PRODUCTS));
    expect(result.effect).toBe('none');
    expect(result.predicate).toBeUndefined();
  });

  test("'none' link mode ignores a selection on its own dataset", () =>
    expect(propagateSelection(workspaceWith(selectionOn(ORDERS)), chartOn(ORDERS, 'none')).effect).toBe('none'));

  test("'filter' link mode reports the filter effect", () => {
    const result = propagateSelection(workspaceWith(selectionOn(ORDERS)), chartOn(ORDERS, 'filter'));
    expect(result.effect).toBe('filter');
  });

  test('reports no effect when nothing is selected', () => {
    const workspace = withRelationship(workspaceWithJoinableDatasets());
    expect(propagateSelection(workspace, chartOn(ORDERS)).effect).toBe('none');
  });

  test('ignores a key-mode selection, which has no cross-dataset meaning', () => {
    const keySelection: Selection = { id: 'sel_1', datasetId: ORDERS, mode: 'keys', keys: ['1'], origin: 'table' };
    expect(propagateSelection(workspaceWith(keySelection), chartOn(ORDERS)).effect).toBe('none');
  });

  test('prefers the chart own dataset selection over a propagated one', () => {
    const base = withRelationship(workspaceWithJoinableDatasets());
    const ownPredicate = { kind: 'comparison' as const, columnId: 'col_own', operator: 'eq' as const, value: 'own' };
    const workspace: Workspace = {
      ...base,
      selections: {
        sel_far: selectionOn(ORDERS),
        sel_own: { id: 'sel_own', datasetId: CUSTOMERS, mode: 'predicate', predicate: ownPredicate, origin: 'chart' },
      },
    };
    expect(propagateSelection(workspace, chartOn(CUSTOMERS)).predicate).toEqual(ownPredicate);
  });
});
