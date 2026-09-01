import { describe, expect, test } from 'bun:test';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { ok } from '@/shared/result/result.ts';
import { createHarness, salesDataset, stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const DATASET_ID = 'ds_sales';

describe('optimistic revision concurrency', () => {
  test('a matching expectedRevision succeeds', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 6 } },
      {
        actor: 'agent',
        expectedRevision: 0,
      },
    );

    expect(result.ok).toBe(true);
    expect(harness.workspace().revision).toBe(1);
  });

  test('a stale expectedRevision is rejected and leaves the workspace deep-equal to before', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });

    const before = structuredClone(harness.workspace());
    const historyBefore = structuredClone(harness.history());

    const result = await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 1 } },
      { actor: 'agent', expectedRevision: 0 },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('STALE_WORKSPACE_REVISION');
    expect(harness.workspace()).toEqual(before);
    expect(harness.history()).toEqual(historyBefore);
  });

  test('the stale error reports both the expected and the current revision', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });

    const result = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 8 } },
      {
        actor: 'agent',
        expectedRevision: 0,
      },
    );

    expect(result.ok ? null : result.error.details).toEqual({ expectedRevision: 0, currentRevision: 1 });
  });

  test('an omitted expectedRevision asserts nothing and always proceeds', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });

    const result = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 8 } },
      {
        actor: 'human',
      },
    );

    expect(result.ok).toBe(true);
    expect(harness.workspace().revision).toBe(2);
  });

  test('a revision ahead of current is rejected too, not only one behind', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 6 } },
      {
        actor: 'agent',
        expectedRevision: 5,
      },
    );

    expect(result.ok ? null : result.error.code).toBe('STALE_WORKSPACE_REVISION');
  });
});

describe('revision increments', () => {
  test('exactly once per successful action', async () => {
    const harness = createHarness();

    // Dispatch together so the queue, not call order, determines execution.
    await Promise.all(
      [4, 6, 8].map((columns) =>
        harness.dispatcher.execute({ type: 'layout.update', payload: { columns } }, { actor: 'human' }),
      ),
    );

    expect(harness.workspace().revision).toBe(3);
    expect(harness.history()).toHaveLength(3);
    expect(harness.history().map((entry) => entry.revision)).toEqual([1, 2, 3]);
  });

  test('never on a rejected action', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });
    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 0 } }, { actor: 'human' });
    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 999 } }, { actor: 'human' });

    expect(harness.workspace().revision).toBe(1);
    expect(harness.history()).toHaveLength(1);
  });

  test('state and revision are committed together, never separately', async () => {
    const harness = createHarness();
    const observed: { columns: number; revision: number }[] = [];

    const unsubscribe = harness.store.subscribe((state) => {
      observed.push({ columns: state.workspace.layout.columns, revision: state.workspace.revision });
    });

    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });
    unsubscribe();

    // One notification proves workspace and revision commit together.
    expect(observed).toEqual([{ columns: 6, revision: 1 }]);
  });
});

describe('serialized execution', () => {
  test('two concurrent actions both commit and the revision advances exactly twice', async () => {
    const harness = createHarness();

    const results = await Promise.all([
      harness.dispatcher.execute(
        { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 1 } },
        { actor: 'human' },
      ),
      harness.dispatcher.execute(
        {
          type: 'filter.apply',
          payload: { datasetId: DATASET_ID, columnId: 'col_region', operator: 'eq', value: 'x' },
        },
        { actor: 'agent' },
      ),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(harness.workspace().revision).toBe(2);
    expect(Object.keys(harness.workspace().filters)).toHaveLength(2);
    expect(harness.history()).toHaveLength(2);
  });

  test('concurrent revision-asserting writes do not both pass the same check', async () => {
    // Serialization prevents both actions from observing revision 0.
    const harness = createHarness();

    const results = await Promise.all([
      harness.dispatcher.execute(
        { type: 'layout.update', payload: { columns: 6 } },
        {
          actor: 'agent',
          expectedRevision: 0,
        },
      ),
      harness.dispatcher.execute(
        { type: 'layout.update', payload: { columns: 8 } },
        {
          actor: 'agent',
          expectedRevision: 0,
        },
      ),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(harness.workspace().revision).toBe(1);
  });

  test('a slow action does not let a later one commit ahead of it', async () => {
    // The asynchronous engine makes queue ordering observable.
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();

    const engine = stubDataEngine(async (_file, datasetId) => {
      await gate;

      return ok({ relationId: `dataset_${datasetId.slice(-4)}`, rowCount: 1, columns: [] });
    });

    // Seed a loading dataset for the slow import action.
    const base = workspaceWithDataset();
    const pending = { ...salesDataset('ds_pending'), importStatus: 'loading' as const };
    const harness = createHarness({ ...base, datasets: { ...base.datasets, [pending.id]: pending } }, engine);

    const slow = harness.dispatcher.execute(
      { type: 'dataset.import', payload: { file: new Blob(['a\n1']), datasetId: pending.id } },
      { actor: 'human' },
    );
    const fast = harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });

    release();

    const [slowResult, fastResult] = await Promise.all([slow, fast]);

    expect(slowResult.ok && slowResult.value.revision).toBe(1);
    expect(fastResult.ok && fastResult.value.revision).toBe(2);
    expect(harness.history().map((entry) => entry.type)).toEqual(['dataset.import', 'layout.update']);
  });

  test('a rejected action does not block the actions queued behind it', async () => {
    const harness = createHarness();

    const [first, second] = await Promise.all([
      harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 0 } }, { actor: 'human' }),
      harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' }),
    ]);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(harness.workspace().revision).toBe(1);
  });
});

// Strips the two fields that must legitimately differ: generated identity and attribution.
const normalize = (workspace: Workspace) => ({
  revision: workspace.revision,
  filters: Object.values(workspace.filters).map(({ id: _id, origin: _origin, createdBy: _createdBy, ...rest }) => rest),
});

describe('human and agent equivalence', () => {
  test('the same action from either actor produces the same workspace, differing only in attribution', async () => {
    const human = createHarness();
    const agent = createHarness();

    const payload = { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt' as const, value: 100 };

    await human.dispatcher.execute({ type: 'filter.apply', payload }, { actor: 'human' });
    await agent.dispatcher.execute({ type: 'filter.apply', payload }, { actor: 'agent' });

    expect(normalize(human.workspace())).toEqual(normalize(agent.workspace()));
    expect(Object.values(human.workspace().filters)[0]?.origin).toBe('human');
    expect(Object.values(agent.workspace().filters)[0]?.origin).toBe('agent');
  });
});
