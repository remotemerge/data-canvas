import { useEffect, useState } from 'react';
import type { TableWindow } from '@/application/ports/data-engine-port.ts';
import { fetchTableWindow } from '@/application/queries/table-window-query.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { Filter, FilterExpression } from '@/domain/filter/filter.ts';
import type { SortSpec } from '@/domain/analysis/analysis-query.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';

export interface TableWindowState {
  window: TableWindow | null;
  loading: boolean;
  error: DomainError | null;
}

export const useTableWindow = (
  dataset: Dataset,
  offset: number,
  limit: number,
  filters: Filter[],
  sort: SortSpec[],
  selectionPredicate?: FilterExpression,
): TableWindowState => {
  const [state, setWindowState] = useState<TableWindowState>({ window: null, loading: true, error: null });

  // Derived columns leave dataset.revision unchanged, so include their IDs in the refetch key.
  const projectionKey = dataset.columns.map((column) => column.id).join(',');

  useEffect(() => {
    /*
     * The import placeholder enters the workspace before the engine holds its relation, so querying
     * it here would surface a transient DATASET_NOT_FOUND. Wait for the relation instead.
     */
    if (dataset.importStatus !== 'ready') {
      setWindowState({ window: null, loading: dataset.importStatus === 'loading', error: null });

      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setWindowState((current) => ({ ...current, loading: true, error: null }));
      void fetchTableWindow(registeredDataEngine, {
        datasetId: dataset.id,
        offset,
        limit,
        filters,
        sort,
        ...(selectionPredicate === undefined ? {} : { selectionPredicate }),
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted || (result.ok && result.value.stale)) {
          return;
        }
        setWindowState((current) =>
          result.ok
            ? { window: result.value, loading: false, error: null }
            : { window: current.window, loading: false, error: result.error },
        );
      });
    }, 100);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    dataset.id,
    dataset.revision,
    dataset.importStatus,
    projectionKey,
    offset,
    limit,
    filters,
    sort,
    selectionPredicate,
  ]);

  return state;
};
