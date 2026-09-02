import { describe, expect, test } from 'bun:test';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { createUndoRedo, HISTORY_STACK_LIMIT } from '@/application/history/undo-redo.ts';
import { createHarness } from './action-fixtures.ts';

const NON_INVERTIBLE_ENTRY: ActionHistoryEntry = {
  actionId: 'history_noninvertible',
  type: 'dataset.remove',
  actor: 'human',
  revision: 0,
  changedEntityIds: [],
  timestamp: '2026-01-01T00:00:00.000Z',
  summary: 'non-invertible',
  undoable: false,
};

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

  test('undo on an empty history is refused rather than throwing', async () => {
    const harness = createHarness();
    const history = createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store });

    expect((await history.undo()).ok).toBe(false);
  });

  test('redo on an empty history is refused rather than throwing', async () => {
    const harness = createHarness();
    const history = createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store });

    expect((await history.redo()).ok).toBe(false);
  });

  /*
   * A dropped DuckDB relation cannot be recreated from workspace state, so the entry stays on the
   * stack as a record and both directions refuse it rather than replaying a partial inverse.
   */
  test('a non-invertible entry is refused in both directions', async () => {
    const harness = createHarness();
    const history = createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store });
    harness.store.setState({
      history: [NON_INVERTIBLE_ENTRY],
      undoStack: [NON_INVERTIBLE_ENTRY.actionId],
      redoStack: [NON_INVERTIBLE_ENTRY.actionId],
    });

    expect((await history.undo()).ok).toBe(false);
    expect((await history.redo()).ok).toBe(false);
  });

  // The bound keeps history from growing without limit across a long session.
  test('the history stack is bounded', () => {
    expect(HISTORY_STACK_LIMIT).toBe(100);
  });
});
