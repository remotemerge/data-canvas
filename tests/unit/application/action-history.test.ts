import { describe, expect, test } from 'bun:test';
import { ACTION_HISTORY_LIMIT, appendHistoryEntry, recentHistory } from '@/application/history/action-history.ts';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { createHarness } from './action-fixtures.ts';

const DATASET_ID = 'ds_sales';

const entry = (revision: number): ActionHistoryEntry => ({
  actionId: `act_${revision}`,
  type: 'layout.update',
  actor: 'human',
  revision,
  changedEntityIds: [],
  timestamp: '2026-01-01T00:00:00.000Z',
  summary: `entry ${revision}`,
  undoable: true,
});

describe('ring buffer', () => {
  test('appends without mutating the original array', () => {
    const original: ActionHistoryEntry[] = [entry(1)];
    const next = appendHistoryEntry(original, entry(2));

    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next).not.toBe(original);
  });

  test('drops the oldest entries once the cap is reached', () => {
    let history: ActionHistoryEntry[] = [];

    for (let revision = 1; revision <= 12; revision += 1) {
      history = appendHistoryEntry(history, entry(revision), 10);
    }

    expect(history).toHaveLength(10);
    expect(history[0]?.revision).toBe(3);
    expect(history.at(-1)?.revision).toBe(12);
  });

  test('a long session cannot grow history without bound', () => {
    let history: ActionHistoryEntry[] = [];

    for (let revision = 1; revision <= ACTION_HISTORY_LIMIT + 250; revision += 1) {
      history = appendHistoryEntry(history, entry(revision));
    }

    expect(history).toHaveLength(ACTION_HISTORY_LIMIT);
    expect(history.at(-1)?.revision).toBe(ACTION_HISTORY_LIMIT + 250);
  });

  test('recentHistory returns the newest entries first', () => {
    const history = [entry(1), entry(2), entry(3), entry(4)];

    expect(recentHistory(history, 2).map((item) => item.revision)).toEqual([4, 3]);
    expect(recentHistory(history, 99).map((item) => item.revision)).toEqual([4, 3, 2, 1]);
    expect(recentHistory([], 5)).toEqual([]);
  });
});

describe('history written by the dispatcher', () => {
  test('records the action type, actor, revision, and changed entities', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 10 } },
      { actor: 'agent' },
    );

    expect(result.ok).toBe(true);

    const [recorded] = harness.history();

    expect(recorded?.type).toBe('filter.apply');
    expect(recorded?.actor).toBe('agent');
    expect(recorded?.revision).toBe(1);
    expect(recorded?.changedEntityIds).toEqual(result.ok ? result.value.changedEntityIds : []);
    expect(recorded?.actionId).toBe(result.ok ? result.value.actionId : '');
    expect(Number.isNaN(Date.parse(recorded?.timestamp ?? ''))).toBe(false);
  });

  test('attributes interleaved human and agent actions correctly', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });
    await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 1 } },
      { actor: 'agent' },
    );
    await harness.dispatcher.execute({ type: 'filters.clear', payload: {} }, { actor: 'system' });

    expect(harness.history().map((item) => item.actor)).toEqual(['human', 'agent', 'system']);
    expect(harness.history().map((item) => item.revision)).toEqual([1, 2, 3]);
  });

  test('keeps the forward payload out of public history fields', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute(
      {
        type: 'filter.apply',
        payload: { datasetId: DATASET_ID, columnId: 'col_notes', operator: 'contains', value: 'confidential-cell' },
      },
      { actor: 'agent' },
    );

    const [recorded] = harness.history();

    // Keep history payload-free so cell values cannot leak through it.
    expect(Object.keys(recorded ?? {}).toSorted()).toEqual([
      'actionId',
      'actor',
      'changedEntityIds',
      'inverseAction',
      'revision',
      'summary',
      'timestamp',
      'type',
      'undoable',
    ]);
    expect(recorded?.summary).not.toContain('confidential-cell');
  });

  test('a rejected action appends nothing', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: 'ds_nope', columnId: 'col_revenue', operator: 'gt', value: 1 } },
      { actor: 'agent' },
    );

    expect(harness.history()).toHaveLength(0);
  });
});
