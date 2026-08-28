import { useEffect, useState } from 'react';
import type { TableWindow } from '@/application/ports/data-engine-port.ts';
import { fetchTableWindow } from '@/application/queries/table-window-query.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { Filter } from '@/domain/filter/filter.ts';
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
): TableWindowState => {
  const [state, setWindowState] = useState<TableWindowState>({ window: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setWindowState((current) => ({ ...current, loading: true, error: null }));
      void fetchTableWindow(registeredDataEngine, {
        datasetId: dataset.id,
        offset,
        limit,
        filters,
        sort,
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted || (result.ok && result.value.stale)) return;
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
  }, [dataset.id, dataset.revision, offset, limit, filters, sort]);

  return state;
};
