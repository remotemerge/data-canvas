import type { Actor, ApplicationAction, ApplicationActionType } from '@/application/actions/action-types.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// One committed action's identity, attribution, summary, and changed entity IDs.
export interface ActionHistoryEntry {
  actionId: string;
  type: ApplicationActionType;
  actor: Actor;
  revision: number;
  changedEntityIds: EntityId[];
  timestamp: string;
  summary: string;
  undoable: boolean;
  inverseAction?: ApplicationAction;
  origin?: 'undo' | 'redo';
}

// Maximum number of history entries kept in the store.
export const ACTION_HISTORY_LIMIT = 500;

// Appends an entry, drops the oldest entries over the limit, and returns a new array.
export const appendHistoryEntry = (
  history: readonly ActionHistoryEntry[],
  entry: ActionHistoryEntry,
  limit: number = ACTION_HISTORY_LIMIT,
): ActionHistoryEntry[] => {
  const appended = [...history, entry];

  return appended.length <= limit ? appended : appended.slice(appended.length - limit);
};

// Returns the most recent history entries first.
export const recentHistory = (history: readonly ActionHistoryEntry[], count: number): ActionHistoryEntry[] =>
  history.slice(Math.max(0, history.length - count)).toReversed();
