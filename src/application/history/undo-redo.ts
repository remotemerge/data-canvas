import type { ApplicationActions } from '@/application/actions/action-types.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err } from '@/shared/result/result.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';

export const HISTORY_STACK_LIMIT = 100;

interface UndoRedoDeps {
  dispatcher: ApplicationActions;
  store: { getState(): WorkspaceState };
}

export const createUndoRedo = ({ dispatcher, store }: UndoRedoDeps) => {
  const execute = async (origin: 'undo' | 'redo') => {
    const state = store.getState();
    const stack = origin === 'undo' ? state.undoStack : state.redoStack;
    const entry = state.history.findLast((candidate) => candidate.actionId === stack.at(-1));

    if (entry === undefined || !entry.undoable || entry.inverseAction === undefined) {
      return err(
        domainError('UNSUPPORTED_OPERATION', 'The next history entry cannot be undone or redone.', {
          reason: entry === undefined ? 'empty' : 'non-invertible',
        }),
      );
    }

    return dispatcher.execute(entry.inverseAction, { actor: 'system', origin });
  };

  return { undo: () => execute('undo'), redo: () => execute('redo') };
};
