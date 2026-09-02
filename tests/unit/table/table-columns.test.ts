import { describe, expect, test } from 'bun:test';
import {
  columnAlignment,
  createTableColumns,
  formatCellValue,
  workspaceTableFeatures,
} from '@/table/tanstack/table-columns.ts';
import type { TableRow } from '@/table/tanstack/table-columns.ts';
import { column } from '../application/action-fixtures.ts';

describe('formatCellValue', () => {
  test('renders both empty markers as an empty cell', () => {
    expect(formatCellValue(null)).toBe('');
    expect(formatCellValue(undefined)).toBe('');
  });

  test('renders a number as its decimal text', () => {
    expect(formatCellValue(12)).toBe('12');
  });

  // Booleans must render rather than disappearing the way a falsy check would make them.
  test('renders false rather than treating it as absent', () => {
    expect(formatCellValue(false)).toBe('false');
  });
});

describe('columnAlignment', () => {
  test('aligns a numeric column to the end so digits line up', () => {
    expect(columnAlignment(column('amount', 'Amount', 'number'))).toBe('end');
  });

  test('aligns a text column to the start', () => {
    expect(columnAlignment(column('label', 'Label', 'string'))).toBe('start');
  });
});

const columns = () => createTableColumns([column('amount', 'Amount', 'number'), column('label', 'Label', 'string')]);

describe('createTableColumns', () => {
  test('produces one definition per dataset column', () => {
    expect(columns()).toHaveLength(2);
  });

  test('uses the column name as the header', () => {
    expect(columns()[0]?.header).toBe('Amount');
  });

  // Rows arrive as positional arrays, so the accessor reads by index rather than by key.
  test('reads each cell by its column position in the row', () => {
    const accessor = (columns()[0] as unknown as { accessorFn?: (row: TableRow) => unknown }).accessorFn;

    expect(accessor?.([7, 'West'])).toBe(7);
  });

  test('formats a null cell as empty text', () => {
    const cell = columns()[0]?.cell as unknown as (context: { getValue: () => unknown }) => string;

    expect(cell({ getValue: () => null })).toBe('');
  });

  test('formats a numeric cell as text', () => {
    const cell = columns()[0]?.cell as unknown as (context: { getValue: () => unknown }) => string;

    expect(cell({ getValue: () => 7 })).toBe('7');
  });
});

describe('workspaceTableFeatures', () => {
  // Only the presentation features the workspace uses are enabled, keeping the table bundle small.
  test('enables filtering, sorting, and pagination', () => {
    expect(workspaceTableFeatures).toMatchObject({
      columnFilteringFeature: expect.anything(),
      rowSortingFeature: expect.anything(),
      rowPaginationFeature: expect.anything(),
    });
  });
});
