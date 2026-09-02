import { describe, expect, test } from 'bun:test';
import {
  handleCreateRelationship,
  handleRemoveDataset,
  handleRemoveRelationship,
} from '@/application/actions/handlers/relationship-handlers.ts';
import type { HandlerDeps } from '@/application/actions/handlers/handler-types.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { suggestionDatasetNames, suggestRelationships } from '@/application/relationships/suggest-relationships.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { ok } from '@/shared/result/result.ts';
import {
  column,
  createHarness,
  salesDataset,
  stubDataEngine,
  visualization,
  workspaceWithJoinableDatasets,
} from './action-fixtures.ts';

const ORDERS_TO_CUSTOMERS = {
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_customers',
  on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
  kind: 'many_to_one' as const,
  join: 'inner' as const,
};

// An engine whose sampled right key repeats, so a `many_to_one` claim fans out.
const fanningEngine = (): DataEnginePort => ({
  ...stubDataEngine(),
  measureKeyQuality: () => Promise.resolve(ok({ sampledRows: 1400, distinctKeys: 1000 })),
});

const harnessWithJoinableDatasets = (engine: DataEnginePort = stubDataEngine()) =>
  createHarness(workspaceWithJoinableDatasets(), engine);

describe('relationship.create', () => {
  test('commits a relationship and reports it in the summary', async () => {
    const harness = harnessWithJoinableDatasets();
    const result = await harness.dispatcher.execute(
      { type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const [relationshipId] = result.value.changedEntityIds;
    const relationship = harness.workspace().relationships[relationshipId as string];

    expect(relationship?.leftDatasetId).toBe('ds_orders');
    expect(relationship?.join).toBe('inner');
    expect(relationship?.createdBy).toBe('human');
    expect(result.value.summary).toContain('orders');
    expect(result.value.summary).toContain('customers');
  });

  // The summary is user-facing copy, so each join kind needs the article that reads correctly.
  test('names each join kind with the correct article', async () => {
    const cases = [
      { join: 'inner', phrase: 'using an inner join' },
      { join: 'left', phrase: 'using a left join' },
    ] as const;

    const summaries = await Promise.all(
      cases.map(async ({ join }) => {
        const harness = harnessWithJoinableDatasets();
        const result = await harness.dispatcher.execute(
          { type: 'relationship.create', payload: { ...ORDERS_TO_CUSTOMERS, join } },
          { actor: 'human' },
        );

        return result.ok ? result.value.summary : null;
      }),
    );

    for (const [index, { phrase }] of cases.entries()) {
      expect(summaries[index]).toContain(phrase);
      expect(summaries[index]).not.toContain('a inner join');
    }
  });

  test('records the actor that created it', async () => {
    const harness = harnessWithJoinableDatasets();
    const result = await harness.dispatcher.execute(
      { type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS },
      { actor: 'agent' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(harness.workspace().relationships[result.value.changedEntityIds[0] as string]?.createdBy).toBe('agent');
  });

  test('a misdeclared cardinality warns rather than failing', async () => {
    const harness = harnessWithJoinableDatasets(fanningEngine());
    const result = await harness.dispatcher.execute(
      { type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Commit the relationship and include the measurement warning.
    expect(Object.keys(harness.workspace().relationships)).toHaveLength(1);
    expect(result.value.summary).toContain('fan out');
    expect(result.value.summary).toContain('1.40');
  });

  test('a rejected relationship changes nothing', async () => {
    const harness = harnessWithJoinableDatasets();
    const before = structuredClone(harness.workspace());

    const result = await harness.dispatcher.execute(
      {
        type: 'relationship.create',
        payload: {
          ...ORDERS_TO_CUSTOMERS,
          on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_name' }],
        },
      },
      { actor: 'human' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
    expect(harness.workspace()).toEqual(before);
  });

  test('a relationship is undoable', async () => {
    const harness = harnessWithJoinableDatasets();
    await harness.dispatcher.execute({ type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS }, { actor: 'human' });

    const [entry] = harness.history();

    expect(entry?.undoable).toBe(true);
  });
});

describe('relationship.remove', () => {
  test('removes an existing relationship', async () => {
    const harness = harnessWithJoinableDatasets();
    const created = await harness.dispatcher.execute(
      { type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS },
      { actor: 'human' },
    );
    if (!created.ok) {
      throw new Error('setup failed');
    }

    const result = await harness.dispatcher.execute(
      { type: 'relationship.remove', payload: { relationshipId: created.value.changedEntityIds[0] as string } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(harness.workspace().relationships)).toHaveLength(0);
  });

  test('an unknown relationship is refused', async () => {
    const harness = harnessWithJoinableDatasets();
    const result = await harness.dispatcher.execute(
      { type: 'relationship.remove', payload: { relationshipId: 'rel_missing' } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(false);
  });
});

describe('dataset.remove', () => {
  test('removes an unreferenced dataset and drops its relation', async () => {
    const dropped: string[] = [];
    const harness = harnessWithJoinableDatasets({
      ...stubDataEngine(),
      dropDataset: (datasetId) => {
        dropped.push(datasetId);
        return Promise.resolve(ok(undefined));
      },
    });

    const result = await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_products' } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    expect(harness.workspace().datasets['ds_products']).toBeUndefined();
    expect(dropped).toEqual(['ds_products']);
  });

  test('refuses a referenced dataset with DATASET_IN_USE and an explicit count', async () => {
    const workspace = workspaceWithJoinableDatasets();
    const chart = visualization('viz_1', 'ds_orders');
    const harness = createHarness({ ...workspace, visualizations: { [chart.id]: chart } }, stubDataEngine());

    const result = await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_orders' } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('DATASET_IN_USE');
    expect(result.error.message).toContain('1 visualizations');
    // No dependents are orphaned because none were removed.
    expect(harness.workspace().datasets['ds_orders']).toBeDefined();
    expect(harness.workspace().visualizations['viz_1']).toBeDefined();
  });

  test('cascade removes the dataset together with everything referencing it', async () => {
    const workspace = workspaceWithJoinableDatasets();
    const chart = visualization('viz_1', 'ds_orders');
    const harness = createHarness(
      {
        ...workspace,
        visualizations: { [chart.id]: chart },
        layout: { columns: 12, items: [{ visualizationId: 'viz_1', x: 0, y: 0, width: 6, height: 4 }] },
      },
      stubDataEngine(),
    );

    await harness.dispatcher.execute({ type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS }, { actor: 'human' });

    const result = await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_orders', cascade: true } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const after = harness.workspace();

    expect(after.datasets['ds_orders']).toBeUndefined();
    expect(after.visualizations['viz_1']).toBeUndefined();
    expect(Object.keys(after.relationships)).toHaveLength(0);
    // Remove the layout slot with the visualization.
    expect(after.layout.items).toHaveLength(0);
    expect(result.value.summary).toContain('2 entities');
  });

  // Every entity kind that can reference a dataset has to be swept, not just the charts and joins.
  test('cascade also drops the filters, selections, metrics, and annotations that reference the dataset', async () => {
    const workspace = workspaceWithJoinableDatasets();
    const chart = visualization('viz_1', 'ds_orders');
    const harness = createHarness(
      {
        ...workspace,
        visualizations: { [chart.id]: chart },
        layout: { columns: 12, items: [{ visualizationId: 'viz_1', x: 0, y: 0, width: 6, height: 4 }] },
      },
      stubDataEngine(),
    );

    await harness.dispatcher.execute(
      {
        type: 'filter.apply',
        payload: { datasetId: 'ds_orders', columnId: 'col_order_revenue', operator: 'gt', value: 1 },
      },
      { actor: 'human' },
    );
    await harness.dispatcher.execute(
      { type: 'selection.set', payload: { datasetId: 'ds_orders', mode: 'keys', keys: ['order-1'], origin: 'table' } },
      { actor: 'human' },
    );
    await harness.dispatcher.execute(
      {
        type: 'metric.create',
        payload: { datasetId: 'ds_orders', name: 'Revenue', aggregate: 'sum', columnId: 'col_order_revenue' },
      },
      { actor: 'human' },
    );
    await harness.dispatcher.execute({ type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS }, { actor: 'human' });
    await harness.dispatcher.execute(
      {
        type: 'annotation.add',
        payload: {
          visualizationId: 'viz_1',
          text: 'note',
          anchor: { kind: 'category', value: 'West' },
          origin: 'human',
        },
      },
      { actor: 'human' },
    );

    const result = await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_orders', cascade: true } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);

    const after = harness.workspace();

    expect(after.datasets['ds_orders']).toBeUndefined();
    expect(Object.keys(after.filters)).toHaveLength(0);
    expect(Object.keys(after.selections)).toHaveLength(0);
    expect(Object.keys(after.metrics)).toHaveLength(0);
    expect(Object.keys(after.relationships)).toHaveLength(0);
    expect(Object.keys(after.annotations)).toHaveLength(0);
    expect(Object.keys(after.visualizations)).toHaveLength(0);
  });

  /*
   * A derived column points at its dataset, so leaving one behind orphans a definition the compiler
   * can no longer resolve and that `handleRemoveDerivedColumn` cannot clean up.
   */
  test('cascade drops the derived columns defined on the dataset', async () => {
    const harness = createHarness(workspaceWithJoinableDatasets(), stubDataEngine());

    const created = await harness.dispatcher.execute(
      {
        type: 'derivedColumn.create',
        payload: {
          datasetId: 'ds_orders',
          name: 'Doubled revenue',
          expression: {
            kind: 'arithmetic',
            op: 'mul',
            left: { kind: 'column', columnId: 'col_order_revenue' },
            right: { kind: 'literal', value: 2 },
          },
        },
      },
      { actor: 'human' },
    );

    expect(created.ok).toBe(true);
    expect(Object.keys(harness.workspace().derivedColumns)).toHaveLength(1);

    const result = await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_orders', cascade: true } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(harness.workspace().derivedColumns)).toHaveLength(0);
  });

  test('removing the active dataset activates another rather than leaving a dangling id', async () => {
    const harness = harnessWithJoinableDatasets();

    expect(harness.workspace().activeDatasetId).toBe('ds_orders');

    const result = await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_orders' } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);

    const activeDatasetId = harness.workspace().activeDatasetId;

    expect(activeDatasetId).toBeDefined();
    expect(harness.workspace().datasets[activeDatasetId as string]).toBeDefined();
  });

  test('is not undoable, because its DuckDB relation is gone', async () => {
    const harness = harnessWithJoinableDatasets();
    await harness.dispatcher.execute(
      { type: 'dataset.remove', payload: { datasetId: 'ds_products' } },
      { actor: 'human' },
    );

    expect(harness.history()[0]?.undoable).toBe(false);
  });
});

describe('cross-dataset visualizations', () => {
  test('a chart may bind a dimension from a related dataset', async () => {
    const harness = harnessWithJoinableDatasets();
    await harness.dispatcher.execute({ type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS }, { actor: 'human' });

    const result = await harness.dispatcher.execute(
      {
        type: 'visualization.create',
        payload: {
          datasetId: 'ds_orders',
          title: 'Revenue by region',
          kind: 'bar',
          binding: { x: 'col_customer_region', y: ['col_order_revenue'] },
        },
      },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
  });

  test('a chart cannot bind a column from an unrelated dataset', async () => {
    const harness = harnessWithJoinableDatasets();

    const result = await harness.dispatcher.execute(
      {
        type: 'visualization.create',
        payload: {
          datasetId: 'ds_orders',
          title: 'Revenue by region',
          kind: 'bar',
          binding: { x: 'col_customer_region', y: ['col_order_revenue'] },
        },
      },
      { actor: 'human' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });
});

/*
 * Called without the dispatcher so a handler defect cannot be masked by dispatcher-level guards that
 * both the human and the agent path happen to share.
 */
describe('relationship handlers called directly', () => {
  const handlerDeps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };

  test('creating a relationship succeeds and reports the new relationship id', async () => {
    const result = await handleCreateRelationship(workspaceWithJoinableDatasets(), ORDERS_TO_CUSTOMERS, handlerDeps);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.changedEntityIds).toHaveLength(1);
  });

  test('removing a relationship the handler just created succeeds', async () => {
    const created = await handleCreateRelationship(workspaceWithJoinableDatasets(), ORDERS_TO_CUSTOMERS, handlerDeps);
    if (!created.ok) {
      throw new Error('setup failed');
    }

    const removed = await handleRemoveRelationship(
      created.value.workspace,
      { relationshipId: created.value.changedEntityIds[0] as string },
      handlerDeps,
    );

    expect(removed.ok).toBe(true);
  });

  test('removing an unreferenced dataset succeeds', async () => {
    const result = await handleRemoveDataset(
      workspaceWithJoinableDatasets(),
      { datasetId: 'ds_products' },
      handlerDeps,
    );

    expect(result.ok).toBe(true);
  });

  // The dataset is resolved before the engine is asked to drop a relation that may not exist.
  test('removing a dataset the workspace does not hold is refused', async () => {
    const result = await handleRemoveDataset(workspaceWithJoinableDatasets(), { datasetId: 'ds_missing' }, handlerDeps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DATASET_NOT_FOUND');
    }
  });
});

const leftDataset = () => ({
  ...salesDataset('ds_left'),
  name: 'Left',
  columns: [
    column('left_label', 'label', 'string'),
    column('left_key', 'shared_id', 'number'),
    column('left_fk', 'customer_id', 'number'),
    column('left_mismatch', 'mismatch', 'number'),
    column('left_unmatched', 'amount', 'number'),
  ],
});

const rightDataset = () => ({
  ...salesDataset('ds_right'),
  name: 'Customers',
  columns: [
    column('right_label', 'label', 'string'),
    column('right_key', 'shared_id', 'number'),
    column('right_id', 'id', 'number'),
    // A same-named column of a different type must not be proposed as a join key.
    column('right_mismatch', 'mismatch', 'string'),
    column('right_unmatched', 'other', 'number'),
  ],
});

describe('suggestRelationships', () => {
  const suggestionWorkspace = (): Workspace => {
    const left = leftDataset();
    const right = rightDataset();
    const loading = { ...right, id: 'ds_loading', importStatus: 'loading' as const };

    return {
      ...createEmptyWorkspace('Suggestions'),
      datasets: { [left.id]: left, [right.id]: right, [loading.id]: loading },
    };
  };

  const withColumns = (leftColumns: ReturnType<typeof column>[], rightColumns: ReturnType<typeof column>[]) => {
    const base = suggestionWorkspace();

    return suggestRelationships({
      ...base,
      datasets: {
        ds_left: { ...leftDataset(), columns: leftColumns },
        ds_right: { ...rightDataset(), columns: rightColumns },
      },
    });
  };

  test('proposes a shared key column', () => {
    expect(suggestRelationships(suggestionWorkspace()).some((item) => item.reason.includes('key column'))).toBe(true);
  });

  test('proposes columns that merely share a name', () => {
    expect(suggestRelationships(suggestionWorkspace()).some((item) => item.reason.includes('column named'))).toBe(true);
  });

  // A foreign key named after the other dataset is the strongest signal, so it is ranked first.
  test('ranks a foreign key naming the other dataset above the alternatives', () => {
    const suggestions = withColumns(
      [column('left_fk_only', 'customer_id', 'number')],
      [column('right_id_only', 'id', 'number')],
    );

    expect(suggestions[0]?.reason).toContain("names the 'Customers' dataset");
  });

  test('falls back to a shared column name when no foreign key names a dataset', () => {
    const suggestions = withColumns(
      [column('left_label_only', 'label', 'string')],
      [column('right_label_only', 'label', 'string')],
    );

    expect(suggestions[0]?.reason).toContain('column named');
  });

  /*
   * Boolean is outside the numeric, temporal, and text key classes, so it compares as its own type. Two
   * booleans stay compatible with each other, while a boolean against a text column is not proposed.
   */
  test('boolean columns are compared as their own key class', () => {
    expect(
      withColumns([column('left_flag', 'flag', 'boolean')], [column('right_flag', 'flag', 'boolean')]).length,
    ).toBeGreaterThan(0);
    expect(withColumns([column('left_flag', 'flag', 'boolean')], [column('right_flag', 'flag', 'string')])).toEqual([]);
  });

  // A dataset still importing has no settled schema, so joining against it would be a guess.
  test('ignores a dataset that has not finished importing', () => {
    const suggestions = suggestRelationships(suggestionWorkspace());

    expect(
      suggestions.every((item) => item.leftDatasetId !== 'ds_loading' && item.rightDatasetId !== 'ds_loading'),
    ).toBe(true);
  });

  // Names that share neither a spelling nor a key stem give the scorer nothing to go on.
  test('proposes nothing for two datasets with no comparable column names', () => {
    const left = {
      ...salesDataset('ds_suggestion_left'),
      name: 'Left',
      columns: [column('left_amount', 'amount', 'number')],
    };
    const right = {
      ...salesDataset('ds_suggestion_right'),
      name: 'Right',
      columns: [column('right_total', 'total', 'number')],
    };

    expect(
      suggestRelationships({
        ...createEmptyWorkspace('Suggestions'),
        datasets: { [left.id]: left, [right.id]: right },
      }),
    ).toEqual([]);
  });

  /*
   * `customer_id` and `customer` share a key stem but neither names the other dataset, so the pair
   * scores below a matching name or a dataset-naming foreign key.
   */
  test('scores a shared key stem below the stronger naming signals', () => {
    const left = {
      ...salesDataset('ds_left_stem'),
      name: 'Alpha',
      columns: [column('left_customer', 'customer_id', 'number')],
    };
    const right = {
      ...salesDataset('ds_right_stem'),
      name: 'Beta',
      columns: [column('right_customer', 'customer', 'number')],
    };
    const suggestions = suggestRelationships({
      ...createEmptyWorkspace('Unmatched'),
      datasets: { [left.id]: left, [right.id]: right },
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.confidence).toBe(0.6);
    expect(suggestions[0]?.reason).toContain('name the same key');
  });

  test('proposes nothing for a pair that is already related', () => {
    const connected: Relationship = {
      id: 'rel_connected',
      leftDatasetId: 'ds_left',
      rightDatasetId: 'ds_right',
      on: [{ leftColumnId: 'left_key', rightColumnId: 'right_key' }],
      kind: 'many_to_one',
      join: 'inner',
      createdBy: 'human',
    };

    expect(suggestRelationships({ ...suggestionWorkspace(), relationships: { [connected.id]: connected } })).toEqual(
      [],
    );
  });
});

describe('suggestionDatasetNames', () => {
  test('resolves both dataset names for display', () => {
    const workspace = workspaceWithJoinableDatasets();
    const [suggestion] = suggestRelationships(workspace);
    if (suggestion === undefined) {
      throw new Error('expected a suggestion');
    }

    expect(suggestionDatasetNames(workspace, suggestion)).toEqual({
      left: workspace.datasets[suggestion.leftDatasetId]?.name ?? '',
      right: workspace.datasets[suggestion.rightDatasetId]?.name ?? '',
    });
  });

  // A suggestion outliving the dataset it names must render the id rather than an empty label.
  test('falls back to the dataset id when a dataset is gone', () => {
    expect(
      suggestionDatasetNames(createEmptyWorkspace('Suggestions'), {
        leftDatasetId: 'missing_left',
        rightDatasetId: 'missing_right',
        leftColumnId: 'left',
        rightColumnId: 'right',
        leftColumnName: 'left',
        rightColumnName: 'right',
        kind: 'many_to_one',
        confidence: 0,
        reason: 'fixture',
      }),
    ).toEqual({ left: 'missing_left', right: 'missing_right' });
  });
});
