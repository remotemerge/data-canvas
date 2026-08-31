import { SELECTION_LINK_MODES, type SelectionLinkMode } from '@/domain/visualization/selection-link-mode.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { useActions } from '@/state/use-actions.ts';

const LABELS: Record<SelectionLinkMode, string> = {
  none: 'Ignore',
  highlight: 'Highlight',
  filter: 'Filter',
};

const DESCRIPTIONS: Record<SelectionLinkMode, string> = {
  none: 'Ignores selections made elsewhere',
  highlight: 'Dims marks outside the selection',
  filter: 'Restricts this chart to the selection',
};

// Selects how a chart responds to selection.
export const LinkModeControl = ({
  visualizationId,
  linkMode,
  onError,
}: {
  visualizationId: EntityId;
  linkMode: SelectionLinkMode;
  onError: (error: DomainError) => void;
}): React.JSX.Element => {
  const actions = useActions();
  const selectId = `link-mode-${visualizationId}`;

  const change = async (next: SelectionLinkMode): Promise<void> => {
    const outcome = await actions.setVisualizationLinkMode({ visualizationId, linkMode: next });

    if (!outcome.ok) onError(outcome.error);
  };

  return (
    <span className="link-mode-control">
      <label className="link-mode-control__label" htmlFor={selectId}>
        Selection
      </label>
      <select
        id={selectId}
        className="link-mode-control__select"
        value={linkMode}
        title={DESCRIPTIONS[linkMode]}
        onChange={(event) => void change(event.target.value as SelectionLinkMode)}
      >
        {SELECTION_LINK_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {LABELS[mode]}
          </option>
        ))}
      </select>
    </span>
  );
};
