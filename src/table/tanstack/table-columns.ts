import { columnFilteringFeature, rowPaginationFeature, rowSortingFeature, tableFeatures } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import type { Column } from '@/domain/dataset/dataset.ts';
import { isNumericType } from '@/domain/logical-type.ts';

export type TableRow = readonly (string | number | boolean | null)[];
export const workspaceTableFeatures = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
});
// Row cells are scalars by the `TableRow` contract, so each has a faithful string form.
export const formatCellValue = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value as string | number | boolean);

export const columnAlignment = (column: Column): 'end' | 'start' =>
  isNumericType(column.logicalType) ? 'end' : 'start';

export const createTableColumns = (columns: readonly Column[]): ColumnDef<typeof workspaceTableFeatures, TableRow>[] =>
  columns.map((column, index) => ({
    id: column.id,
    accessorFn: (row) => row[index],
    header: column.name,
    cell: ({ getValue }) => {
      const value = getValue();
      return formatCellValue(value);
    },
  }));
