import { describe, expect, test } from 'bun:test';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { ok } from '@/shared/result/result.ts';
import { createHarness, stubDataEngine, visualization, workspaceWithJoinableDatasets } from './action-fixtures.ts';

const ORDERS_TO_CUSTOMERS = {
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_customers',
  on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
  kind: 'many_to_one' as const,
  join: 'inner' as const,
};

/** An engine whose sampled right key repeats, so a `many_to_one` claim fans out. */
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
    if (!result.ok) return;

    const [relationshipId] = result.value.changedEntityIds;
    const relationship = harness.workspace().relationships[relationshipId as string];

    expect(relationship?.leftDatasetId).toBe('ds_orders');
    expect(relationship?.join).toBe('inner');
    expect(relationship?.createdBy).toBe('human');
    expect(result.value.summary).toContain('orders');
    expect(result.value.summary).toContain('customers');
  });

  test('records the actor that created it', async () => {
    const harness = harnessWithJoinableDatasets();
    const result = await harness.dispatcher.execute(
      { type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS },
      { actor: 'agent' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.workspace().relationships[result.value.changedEntityIds[0] as string]?.createdBy).toBe('agent');
  });

  test('a misdeclared cardinality warns rather than failing', async () => {
    const harness = harnessWithJoinableDatasets(fanningEngine());
    const result = await harness.dispatcher.execute(
      { type: 'relationship.create', payload: ORDERS_TO_CUSTOMERS },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Committed, with the measurement stated — not silently proceeding and not refusing.
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
    if (result.ok) return;
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
    if (!created.ok) throw new Error('setup failed');

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
    if (result.ok) return;
    expect(result.error.code).toBe('DATASET_IN_USE');
    expect(result.error.message).toContain('1 visualizations');
    // Nothing is orphaned, because nothing was removed.
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
    if (!result.ok) return;

    const after = harness.workspace();

    expect(after.datasets['ds_orders']).toBeUndefined();
    expect(after.visualizations['viz_1']).toBeUndefined();
    expect(Object.keys(after.relationships)).toHaveLength(0);
    // The layout slot goes too, or the canvas would reserve space for a chart that no longer exists.
    expect(after.layout.items).toHaveLength(0);
    expect(result.value.summary).toContain('2 entities');
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
    if (result.ok) return;
    expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });
});
