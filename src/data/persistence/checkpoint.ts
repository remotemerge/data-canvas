import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import type { PersistenceDatabase } from '@/data/persistence/persistence-database.ts';
import { serializeEntity } from '@/data/persistence/schema/entity-serialization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';

export interface CheckpointState {
  workspace: Workspace;
  history: ActionHistoryEntry[];
  undoStack?: string[];
  redoStack?: string[];
}

export const writeCheckpoint = async (db: PersistenceDatabase, state: CheckpointState): Promise<void> => {
  await db.query('BEGIN TRANSACTION');
  try {
    const statement = await db.prepare(
      'INSERT OR REPLACE INTO app_workspace_meta (id, schema_version, revision, payload) VALUES (?, ?, ?, ?)',
    );
    try {
      await statement.query(
        state.workspace.id,
        state.workspace.schemaVersion,
        state.workspace.revision,
        serializeEntity({
          ...state.workspace,
          history: state.history,
          undoStack: state.undoStack ?? [],
          redoStack: state.redoStack ?? [],
        }),
      );
    } finally {
      await statement.close();
    }
    await db.query('COMMIT');
    await db.query('CHECKPOINT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

export interface CheckpointScheduler {
  schedule(state: CheckpointState): void;
  flush(): Promise<void>;
  dispose(): void;
}

export const createCheckpointScheduler = (
  write: (state: CheckpointState) => Promise<void>,
  delayMs = 500,
  onError: (error: unknown) => void = () => undefined,
): CheckpointScheduler => {
  let pending: CheckpointState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  const flush = async (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const state = pending;
    pending = null;
    if (state === null) return inFlight;
    inFlight = inFlight.then(() => write(state)).catch((error) => onError(error));
    return inFlight;
  };
  return {
    schedule: (state) => {
      pending = state;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
};
