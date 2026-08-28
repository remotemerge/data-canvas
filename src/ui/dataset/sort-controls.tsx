import type { Column } from '@/domain/dataset/dataset.ts';
import type { SortSpec } from '@/domain/analysis/analysis-query.ts';

interface SortControlsProps {
  column: Column;
  sort: SortSpec[];
  onChange(sort: SortSpec[]): void;
}

export const SortControls = ({ column, sort, onChange }: SortControlsProps): React.JSX.Element => {
  const current = sort.find((entry) => entry.columnId === column.id);
  const label =
    current === undefined ? 'Not sorted' : current.direction === 'asc' ? 'Sorted ascending' : 'Sorted descending';
  return (
    <button
      className="data-table__sort"
      type="button"
      aria-label={`${column.name}: ${label}`}
      onClick={() =>
        onChange(
          current === undefined
            ? [{ columnId: column.id, direction: 'asc' }]
            : current.direction === 'asc'
              ? [{ columnId: column.id, direction: 'desc' }]
              : [],
        )
      }
    >
      {column.name} {current === undefined ? '' : current.direction === 'asc' ? '↑' : '↓'}
    </button>
  );
};
