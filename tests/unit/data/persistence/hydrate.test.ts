import { describe, expect, test } from 'bun:test';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { hydrateWorkspace } from '@/data/persistence/hydrate-workspace.ts';
import type { PersistenceDatabase } from '@/data/persistence/persistence-database.ts';
import { serializeEntity } from '@/data/persistence/schema/entity-serialization.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';

/*
 * Hydration takes the database as a parameter so the stored-metadata paths stay reachable under
 * `bun test`, where no OPFS handle exists. Only the single metadata read is modelled here.
 */
const databaseReturning = (rows: unknown[]): PersistenceDatabase => ({
  query: async () => ({ toArray: () => rows }),
  prepare: async () => {
    throw new Error('prepare is not used by hydrateWorkspace');
  },
});

describe('workspace hydration', () => {
  test('rebuilds the normalized workspace from stored metadata', async () => {
    const workspace = createEmptyWorkspace('Saved workspace');
    const database = databaseReturning([{ payload: serializeEntity(workspace) }]);

    const hydrated = await hydrateWorkspace(database);

    expect(hydrated?.workspace).toEqual(workspace);
    expect(hydrated?.warnings).toEqual([]);
  });

  test('separates history and undo stacks from the workspace entity', async () => {
    const workspace = createEmptyWorkspace('Saved workspace');
    const entry: ActionHistoryEntry = {
      actionId: 'act_1',
      type: 'filter.apply',
      actor: 'human',
      revision: 1,
      changedEntityIds: [],
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'Applied a filter',
      undoable: true,
    };
    const database = databaseReturning([
      {
        payload: serializeEntity({
          ...workspace,
          history: [entry],
          undoStack: ['act_1'],
          redoStack: ['act_2'],
        }),
      },
    ]);

    const hydrated = await hydrateWorkspace(database);

    expect(hydrated?.history).toEqual([entry]);
    expect(hydrated?.undoStack).toEqual(['act_1']);
    expect(hydrated?.redoStack).toEqual(['act_2']);
    // The transient stacks must not leak back into the persisted workspace shape.
    expect(hydrated?.workspace).toEqual(workspace);
  });

  test('defaults the undo stacks when stored metadata omits them', async () => {
    const workspace = createEmptyWorkspace('Saved workspace');
    const database = databaseReturning([{ payload: serializeEntity(workspace) }]);

    const hydrated = await hydrateWorkspace(database);

    expect(hydrated?.history).toEqual([]);
    expect(hydrated?.undoStack).toEqual([]);
    expect(hydrated?.redoStack).toEqual([]);
  });

  test('reports a warning for a corrupt entity instead of discarding the workspace', async () => {
    const database = databaseReturning([{ payload: serializeEntity({ id: 'ws_1' }) }]);

    const hydrated = await hydrateWorkspace(database);

    expect(hydrated).not.toBeNull();
    expect(hydrated?.warnings).toEqual(['Stored workspace metadata is invalid.']);
  });

  test('returns null when the stored payload cannot be parsed', async () => {
    const database = databaseReturning([{ payload: '{ not json' }]);

    expect(await hydrateWorkspace(database)).toBeNull();
  });

  test('returns null when no workspace has been checkpointed', async () => {
    expect(await hydrateWorkspace(databaseReturning([]))).toBeNull();
  });
});
