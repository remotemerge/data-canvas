import { useTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createTableColumns, workspaceTableFeatures } from '@/table/tanstack/table-columns.ts';
import { useTableWindow } from '@/table/tanstack/use-table-window.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { SortSpec } from '@/domain/analysis/analysis-query.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectFilters } from '@/state/selectors/workspace-selectors.ts';
import { SortControls } from '@/ui/dataset/sort-controls.tsx';

const WINDOW_SIZE = 500;
const ROW_HEIGHT = 34;
const EMPTY_SORT: SortSpec[] = [];

/**
 * Rows rendered beyond the viewport.
 *
 * Measured against the 1M-row fixture rather than picked: below roughly 20 rows a fast scroll
 * outruns the render and shows blank bands, while above it the extra DOM costs more per frame than
 * the smoothness is worth. Each overscanned row is a full row of cells, so this multiplies by the
 * column count.
 */
const OVERSCAN_ROWS = 20;

/**
 * How close to a window edge scrolling gets before the next window is fetched.
 *
 * Without it the fetch only starts once the boundary is crossed, so the rows immediately after it
 * are always blank for one round trip. Fetching a fifth of a window early hides that latency behind
 * the scroll that is already in progress.
 */
const PREFETCH_MARGIN = Math.floor(WINDOW_SIZE / 5);

export const WorkspaceTable = ({ dataset }: { dataset: Dataset }): React.JSX.Element => {
  const filterRecord = useWorkspace(selectFilters);
  const selectionRecord = useWorkspace((state) => state.workspace.selections);
  const tableSorts = useWorkspace((state) => state.workspace.tableSorts);
  const filters = useMemo(() => {
    const stored = Object.values(filterRecord).filter((filter) => filter.datasetId === dataset.id);
    const predicate = Object.values(selectionRecord).find((selection) => selection.datasetId === dataset.id)?.predicate;
    if (predicate?.kind !== 'comparison') return stored;
    return [
      ...stored,
      {
        id: `selection_${dataset.id}`,
        datasetId: dataset.id,
        columnId: predicate.columnId,
        operator: predicate.operator,
        ...(predicate.value === undefined ? {} : { value: predicate.value }),
        enabled: true,
        origin: 'system' as const,
        createdBy: 'system' as const,
      },
    ];
  }, [dataset.id, filterRecord, selectionRecord]);
  const sort = tableSorts[dataset.id] ?? EMPTY_SORT;
  const { clearFilters, setTableSort } = useActions();
  const [offset, setOffset] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const state = useTableWindow(dataset, offset, WINDOW_SIZE, filters, sort);
  const columns = useMemo(() => createTableColumns(dataset.columns), [dataset.columns]);
  const table = useTable({
    features: workspaceTableFeatures,
    data: state.window?.rows ?? [],
    columns,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    rowCount: state.window?.totalRowCount ?? dataset.rowCount ?? 0,
  });
  const total = state.window?.totalRowCount ?? dataset.rowCount ?? 0;
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const firstVisible = virtualRows[0]?.index ?? 0;
  const lastVisible = virtualRows[virtualRows.length - 1]?.index ?? firstVisible;
  // The window is chosen from whichever edge is closer to leaving the current one, so scrolling in
  // either direction triggers the fetch before the blank rows would appear.
  const anchor = lastVisible + PREFETCH_MARGIN >= offset + WINDOW_SIZE ? lastVisible + PREFETCH_MARGIN : firstVisible;
  const wantedOffset = Math.max(Math.floor(anchor / WINDOW_SIZE) * WINDOW_SIZE, 0);
  useEffect(() => setOffset(wantedOffset), [wantedOffset]);

  return (
    <section className="data-table" aria-busy={state.loading}>
      <div className="data-table__status">
        <span>{total.toLocaleString()} rows</span>
        {state.loading ? <span>Loading…</span> : null}
      </div>
      {state.error !== null ? (
        <p className="action-error">
          <span className="action-error__code">{state.error.code}</span>
          <span>{state.error.message}</span>
        </p>
      ) : null}
      {total === 0 && !state.loading ? (
        <div className="workspace__empty">
          <p>No rows match the current filters.</p>
          <button type="button" onClick={() => void clearFilters({ datasetId: dataset.id })}>
            Clear filters
          </button>
        </div>
      ) : (
        <div ref={parentRef} className="data-table__viewport">
          <table className="data-table__table">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header, index) => (
                    <th key={header.id}>
                      <SortControls
                        column={dataset.columns[index] as NonNullable<(typeof dataset.columns)[number]>}
                        sort={sort}
                        onChange={(next) => void setTableSort({ datasetId: dataset.id, sort: next })}
                      />
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index - offset];
                if (row === undefined) return null;
                return (
                  <tr key={virtualRow.key} style={{ transform: `translateY(${virtualRow.start}px)` }}>
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
