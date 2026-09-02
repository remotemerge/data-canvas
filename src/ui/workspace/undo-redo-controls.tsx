import { useEffect } from 'react';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { nextReversibleEntry } from '@/application/history/undo-redo.ts';
import type { ReversibleEntry } from '@/application/history/undo-redo.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

const acceptsText = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return (
    element?.isContentEditable === true ||
    ['input', 'textarea', 'select'].includes(element?.tagName.toLowerCase() ?? '')
  );
};

/*
 * Explains what the control will reverse, or why it cannot. A blocked control names the action that
 * actually blocks it rather than assuming a dataset import, which was only ever one of the causes.
 */
const historyControlTitle = (
  label: 'Undo' | 'Redo',
  target: ReversibleEntry | undefined,
  stack: readonly string[],
  history: readonly ActionHistoryEntry[],
): string => {
  if (target !== undefined) {
    return `${label} ${target.entry.summary}`;
  }

  if (stack.length === 0) {
    return `Nothing to ${label.toLowerCase()}`;
  }

  const blocking = history.findLast((entry) => entry.actionId === stack.at(-1));

  return blocking === undefined
    ? `Nothing to ${label.toLowerCase()}`
    : `Cannot ${label.toLowerCase()}: ${blocking.summary}`;
};

export const UndoRedoControls = ({ onError }: { onError: (error: DomainError) => void }) => {
  const actions = useActions();
  const history = useWorkspace((state) => state.history);
  const undoStack = useWorkspace((state) => state.undoStack);
  const redoStack = useWorkspace((state) => state.redoStack);
  // Undo reaches past entries that cannot be reversed, so the button follows the same resolution.
  const undoTarget = nextReversibleEntry(history, undoStack);
  const redoTarget = nextReversibleEntry(history, redoStack);
  const canUndo = undoTarget !== undefined;
  const canRedo = redoTarget !== undefined;
  const run = async (kind: 'undo' | 'redo') => {
    const result = await actions[kind]();
    if (!result.ok) {
      onError(result.error);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (acceptsText(event.target) || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
        return;
      }
      event.preventDefault();
      void run(event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  return (
    <div className="undo-redo-controls" aria-label="History controls">
      <button
        type="button"
        disabled={!canUndo}
        title={historyControlTitle('Undo', undoTarget, undoStack, history)}
        onClick={() => void run('undo')}
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!canRedo}
        title={historyControlTitle('Redo', redoTarget, redoStack, history)}
        onClick={() => void run('redo')}
      >
        Redo
      </button>
    </div>
  );
};
