import { describe, expect, test } from 'bun:test';
import { createUndoRedo } from '@/application/history/undo-redo.ts';
import { createHarness } from './action-fixtures.ts';

describe('undo and redo', () => {
  test('restores exact metadata through the dispatcher and clears redo after a new action', async () => {
    const harness = createHarness();
    const history = createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store });
    await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: 'ds_sales', columnId: 'col_revenue', operator: 'gt', value: 10 } },
      { actor: 'agent' },
    );
    const filter = structuredClone(harness.workspace().filters);
    expect((await history.undo()).ok).toBe(true);
    expect(harness.workspace().filters).toEqual({});
    expect(harness.workspace().revision).toBe(2);
    expect((await history.redo()).ok).toBe(true);
    expect(harness.workspace().filters).toEqual(filter);
    await history.undo();
    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });
    expect(harness.store.getState().redoStack).toEqual([]);
  });

  test('an undo makes an agent revision stale', async () => {
    const harness = createHarness();
    const history = createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store });
    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });
    await history.undo();
    const stale = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 8 } },
      { actor: 'agent', expectedRevision: 1 },
    );
    expect(stale.ok ? null : stale.error.code).toBe('STALE_WORKSPACE_REVISION');
  });
});
