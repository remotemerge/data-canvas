import { columnFilteringFeature, rowPaginationFeature, rowSortingFeature, tableFeatures } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import type { Column } from '@/domain/dataset/dataset.ts';

export type TableRow = readonly (string | number | boolean | null)[];
export const workspaceTableFeatures = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
});
export const formatCellValue = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

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
