import type { Actor, ApplicationAction, ApplicationActionType } from '@/application/actions/action-types.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * One committed action.
 *
 * Privacy constraint. There is deliberately no `payload` field. A filter payload can contain a
 * dataset cell value, and history is rendered in the UI and is a candidate for persistence and
 * logging. Only the action's identity, attribution, and a value-free summary are recorded.
 *
 * The shape is chosen to be the substrate undo/redo needs later: `changedEntityIds` is what lets a
 * per-entity history view and an inversion step find the entries that touched an entity.
 */
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

/**
 * Ring-buffer capacity.
 *
 * A long analytical session issues thousands of actions, and history lives in the store, so it is
 * capped rather than allowed to grow with session length.
 */
export const ACTION_HISTORY_LIMIT = 500;

/**
 * Appends an entry, dropping the oldest entries once the cap is reached.
 *
 * Returns a new array rather than mutating so the store commit stays a pure value replacement and
 * subscribers see a changed reference.
 */
export const appendHistoryEntry = (
  history: readonly ActionHistoryEntry[],
  entry: ActionHistoryEntry,
  limit: number = ACTION_HISTORY_LIMIT,
): ActionHistoryEntry[] => {
  const appended = [...history, entry];

  return appended.length <= limit ? appended : appended.slice(appended.length - limit);
};

/** Most-recent-first view, for the history panel. */
export const recentHistory = (history: readonly ActionHistoryEntry[], count: number): ActionHistoryEntry[] =>
  history.slice(Math.max(0, history.length - count)).toReversed();
