import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
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
}

export const hydrateWorkspace = async (db: PersistenceDatabase): Promise<HydratedWorkspace | null> => {
  const rows = (
    await db.query('SELECT payload FROM app_workspace_meta ORDER BY revision DESC LIMIT 1')
  ).toArray() as WorkspaceRow[];
  const payload = rows[0]?.payload;
  if (typeof payload !== 'string') return null;
  try {
    const value = deserializeEntity(payload);
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
