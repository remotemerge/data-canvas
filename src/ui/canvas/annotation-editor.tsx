import { useState } from 'react';
import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';

export const AnnotationEditor = ({
  visualizationId,
  anchor,
  onClose,
  onError,
}: {
  visualizationId: string;
  anchor: AnnotationAnchor;
  onClose: () => void;
  onError: (error: DomainError) => void;
}) => {
  const [text, setText] = useState('');
  const actions = useActions();
  const save = async () => {
    const result = await actions.addAnnotation({ visualizationId, anchor, text, origin: 'human' });
    if (!result.ok) onError(result.error);
    else onClose();
  };
  return (
    <form
      className="annotation-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        Note
        <input maxLength={280} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      </label>
      <button type="submit" disabled={text.trim().length === 0}>
        Save
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
};
