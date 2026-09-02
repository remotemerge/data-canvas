import type { ApplicationActions } from '@/application/actions/action-types.ts';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err } from '@/shared/result/result.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';

export const HISTORY_STACK_LIMIT = 100;

// A reversible history entry together with how many non-invertible entries sit above it on the stack.
export interface ReversibleEntry {
  entry: ActionHistoryEntry & { inverseAction: NonNullable<ActionHistoryEntry['inverseAction']> };
  skipped: number;
}

/**
 * Finds the newest entry on a stack that can actually be reversed.
 *
 * Some actions, notably dataset imports and removals, cannot be rebuilt from workspace metadata. They
 * stay in the history for provenance, so undo walks past them instead of stopping at the top of the
 * stack and refusing work that is still reversible underneath.
 */
export const nextReversibleEntry = (
  history: readonly ActionHistoryEntry[],
  stack: readonly string[],
): ReversibleEntry | undefined => {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = history.findLast((candidate) => candidate.actionId === stack[index]);

    if (entry?.undoable === true && entry.inverseAction !== undefined) {
      return {
        entry: entry as ReversibleEntry['entry'],
        skipped: stack.length - 1 - index,
      };
    }
  }

  return undefined;
};

interface UndoRedoDeps {
  dispatcher: ApplicationActions;
  store: { getState(): WorkspaceState };
}

export const createUndoRedo = ({ dispatcher, store }: UndoRedoDeps) => {
  const execute = async (origin: 'undo' | 'redo', expectedRevision?: number) => {
    const state = store.getState();
    const stack = origin === 'undo' ? state.undoStack : state.redoStack;
    const target = nextReversibleEntry(state.history, stack);

    if (target === undefined) {
      return err(
        domainError('UNSUPPORTED_OPERATION', 'There is no action left to undo or redo.', {
          reason: stack.length === 0 ? 'empty' : 'non-invertible',
        }),
      );
    }

    /*
     * A non-invertible action such as a dataset import stays in the visible history as a record, but
     * it must not block the entries beneath it. The dispatcher drops the ones this call skipped along
     * with the entry it reverses, so the stack top keeps matching the next reversible action.
     */
    return dispatcher.execute(target.entry.inverseAction, {
      actor: 'system',
      origin,
      ...(target.skipped === 0 ? {} : { skippedHistoryEntries: target.skipped }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  };

  return {
    undo: (expectedRevision?: number) => execute('undo', expectedRevision),
    redo: (expectedRevision?: number) => execute('redo', expectedRevision),
  };
};
