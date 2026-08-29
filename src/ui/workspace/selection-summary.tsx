import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/**
 * Describes a predicate in plain words.
 *
 * Values are rendered as text by React, never as markup — a selection can carry a cell value, and
 * cell values are untrusted imported content. The description is deliberately shallow: a deeply
 * nested predicate reports its shape rather than its full text, since a chip is not the place to
 * read a boolean tree.
 */
const describePredicate = (predicate: FilterExpression): string => {
  switch (predicate.kind) {
    case 'comparison':
      return `${predicate.operator} ${String(predicate.value ?? '')}`.trim();
    case 'or':
      return `${predicate.operands.length} values`;
    case 'and':
      return `${predicate.operands.length} conditions`;
    case 'not':
      return 'excluded';
  }
};

/**
 * Shows what is currently selected, with a one-click clear.
 *
 * Selection changes what charts display without appearing anywhere itself, which makes a stale
 * selection a common cause of "why is this chart wrong". Naming it in the header turns that into
 * something visible.
 */
export const SelectionSummary = ({ onError }: { onError: (error: DomainError) => void }): React.JSX.Element | null => {
  const actions = useActions();
  const selections = useWorkspace((state) => state.workspace.selections);
  const datasets = useWorkspace((state) => state.workspace.datasets);
  const active = Object.values(selections);

  if (active.length === 0) return null;

  const clear = async (datasetId: string): Promise<void> => {
    const outcome = await actions.clearSelection({ datasetId });

    if (!outcome.ok) onError(outcome.error);
  };

  return (
    <div className="selection-summary" role="status" aria-label="Active selection">
      {active.map((selection) => {
        const datasetName = datasets[selection.datasetId]?.name ?? 'a dataset';
        const detail =
          selection.mode === 'keys'
            ? `${selection.keys?.length ?? 0} rows`
            : selection.predicate === undefined
              ? 'a subset'
              : describePredicate(selection.predicate);

        return (
          <span key={selection.id} className="selection-summary__chip">
            <span className="selection-summary__text">
              {datasetName}: {detail}
            </span>
            <button
              type="button"
              className="selection-summary__clear"
              aria-label={`Clear the selection on ${datasetName}`}
              onClick={() => void clear(selection.datasetId)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
};
