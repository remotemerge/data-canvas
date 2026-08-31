import { useMemo } from 'react';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectFilters } from '@/state/selectors/workspace-selectors.ts';
import { FilterEditor } from '@/ui/dataset/filter-editor.tsx';
import { Provenance } from '@/ui/workspace/provenance.tsx';

export const FilterPanel = ({
  dataset,
  onError,
}: {
  dataset: Dataset;
  onError(error: DomainError | null): void;
}): React.JSX.Element => {
  const filterRecord = useWorkspace(selectFilters);
  const filters = useMemo(
    () => Object.values(filterRecord).filter((filter) => filter.datasetId === dataset.id),
    [dataset.id, filterRecord],
  );
  const { applyFilter, removeFilter, clearFilters } = useActions();
  return (
    <section>
      <h2 className="workspace__panel-heading">Filters</h2>
      <FilterEditor dataset={dataset} onError={onError} />
      {filters.length === 0 ? (
        <p className="workspace__empty">No filters applied.</p>
      ) : (
        <ul className="filter-list">
          {filters.map((filter) => {
            const column = dataset.columns.find((candidate) => candidate.id === filter.columnId);
            return (
              <li key={filter.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={filter.enabled}
                    onChange={(event) =>
                      void applyFilter({
                        datasetId: filter.datasetId,
                        columnId: filter.columnId,
                        operator: filter.operator,
                        ...(filter.value === undefined ? {} : { value: filter.value }),
                        enabled: event.target.checked,
                      }).then((result) => onError(result.ok ? null : result.error))
                    }
                  />
                  {column?.name ?? 'Unknown column'} {filter.operator.replace('_', ' ')}
                  <Provenance entityId={filter.id} createdBy={filter.createdBy} />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void removeFilter({ filterId: filter.id }).then((result) =>
                      onError(result.ok ? null : result.error),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        disabled={filters.length === 0}
        onClick={() =>
          void clearFilters({ datasetId: dataset.id }).then((result) => onError(result.ok ? null : result.error))
        }
      >
        Clear filters
      </button>
    </section>
  );
};
