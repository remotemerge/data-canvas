import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { migrateStoredWorkspace } from '@/data/persistence/migrations/migrate-workspace.ts';
import type { PersistenceDatabase } from '@/data/persistence/persistence-database.ts';
import { deserializeEntity, isWorkspacePayload } from '@/data/persistence/schema/entity-serialization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';

interface WorkspaceRow {
  payload?: unknown;
}

export interface HydratedWorkspace {
  workspace: Workspace;
  history: ActionHistoryEntry[];
  warnings: string[];
  undoStack: string[];
  redoStack: string[];
  /**
   * Set when the stored workspace could not be brought to the current schema version.
   *
   * Carried as a field rather than thrown so bootstrap can distinguish "nothing saved" (`null`) from
   * "something is saved that this build must not touch", which are opposite outcomes: the second
   * must suppress the checkpoint subscription that would otherwise overwrite the stored file.
   */
  blocked?: boolean;
}

export const hydrateWorkspace = async (db: PersistenceDatabase): Promise<HydratedWorkspace | null> => {
  const rows = (
    await db.query('SELECT payload FROM app_workspace_meta ORDER BY revision DESC LIMIT 1')
  ).toArray() as WorkspaceRow[];
  const payload = rows[0]?.payload;
  if (typeof payload !== 'string') return null;
  try {
    const parsed = deserializeEntity(payload);

    // Migration runs before the domain guard, because a payload from an older schema is expected to
    // fail today's shape check — validating first would reject exactly the data migration exists to
    // repair. A payload this build must not touch is reported as blocked rather than as invalid, so
    // bootstrap can leave the stored file alone instead of checkpointing over it.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        workspace: parsed as Workspace,
        history: [],
        undoStack: [],
        redoStack: [],
        warnings: ['Stored workspace metadata is invalid.'],
      };
    }

    const migrated = migrateStoredWorkspace(parsed as Record<string, unknown>);

    if (!migrated.ok) {
      return {
        workspace: parsed as unknown as Workspace,
        history: [],
        undoStack: [],
        redoStack: [],
        warnings: [migrated.error.message],
        blocked: true,
      };
    }

    const value: unknown = migrated.value;

    if (!isWorkspacePayload(value)) {
      return {
        workspace: value as Workspace,
        history: [],
        undoStack: [],
        redoStack: [],
        warnings: ['Stored workspace metadata is invalid.'],
      };
    }
    const history =
      typeof value === 'object' && value !== null && 'history' in value && Array.isArray(value.history)
        ? (value.history as ActionHistoryEntry[])
        : [];
    const stored = value as Workspace & { history?: ActionHistoryEntry[]; undoStack?: string[]; redoStack?: string[] };
    const { history: _history, undoStack: _undo, redoStack: _redo, ...workspace } = stored;
    return { workspace, history, undoStack: stored.undoStack ?? [], redoStack: stored.redoStack ?? [], warnings: [] };
  } catch {
    return null;
  }
};
