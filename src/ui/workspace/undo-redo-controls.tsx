import { useEffect } from 'react';
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

export const UndoRedoControls = ({ onError }: { onError: (error: DomainError) => void }) => {
  const actions = useActions();
  const history = useWorkspace((state) => state.history);
  const undoStack = useWorkspace((state) => state.undoStack);
  const redoStack = useWorkspace((state) => state.redoStack);
  const undoEntry = history.findLast((entry) => entry.actionId === undoStack.at(-1));
  const canUndo = undoEntry?.undoable === true;
  const canRedo = redoStack.length > 0;
  const run = async (kind: 'undo' | 'redo') => {
    const result = await actions[kind]();
    if (!result.ok) onError(result.error);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (acceptsText(event.target) || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
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
        title={undoEntry !== undefined && !canUndo ? 'Dataset imports cannot be undone.' : 'Undo'}
        onClick={() => void run('undo')}
      >
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={() => void run('redo')}>
        Redo
      </button>
    </div>
  );
};
