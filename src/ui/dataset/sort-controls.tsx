import type { Column } from '@/domain/dataset/dataset.ts';
import type { SortSpec } from '@/domain/analysis/analysis-query.ts';

interface SortControlsProps {
  column: Column;
  sort: SortSpec[];
  onChange(sort: SortSpec[]): void;
}

// Clicking a header cycles the column through unsorted, ascending, then descending.
const SORT_STATE = {
  none: { label: 'Not sorted', indicator: '', next: 'asc' },
  asc: { label: 'Sorted ascending', indicator: '↑', next: 'desc' },
  desc: { label: 'Sorted descending', indicator: '↓', next: 'none' },
} as const;

export const SortControls = ({ column, sort, onChange }: SortControlsProps): React.JSX.Element => {
  const current = sort.find((entry) => entry.columnId === column.id);
  const state = SORT_STATE[current?.direction ?? 'none'];

  return (
    <button
      className="data-table__sort"
      type="button"
      aria-label={`${column.name}: ${state.label}`}
      onClick={() => onChange(state.next === 'none' ? [] : [{ columnId: column.id, direction: state.next }])}
    >
      {column.name} {state.indicator}
    </button>
  );
};
