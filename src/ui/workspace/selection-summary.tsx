import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/**
 * Describes a predicate without exposing markup.
 *
 * Values may come from imported data, so React renders them as text.
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

// Shows the current selection and a clear action.
export const SelectionSummary = ({ onError }: { onError: (error: DomainError) => void }): React.JSX.Element | null => {
  const actions = useActions();
  const selections = useWorkspace((state) => state.workspace.selections);
  const datasets = useWorkspace((state) => state.workspace.datasets);
  const active = Object.values(selections);

  if (active.length === 0) {
    return null;
  }

  const clear = async (datasetId: string): Promise<void> => {
    const outcome = await actions.clearSelection({ datasetId });

    if (!outcome.ok) {
      onError(outcome.error);
    }
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
