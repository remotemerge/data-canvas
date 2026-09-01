import { expect, test } from 'bun:test';
import {
  enforceOutputBudget,
  MAX_TOOL_OUTPUT_LENGTH,
  PRESERVE_COLUMNS_KEY,
} from '@/webmcp/results/enforce-output-budget.ts';

const column = (index: number) => ({
  id: `col_f8aed260-d59f-4837-8e5e-df6e0d0feb${String(index).padStart(3, '0')}`,
  name: `Column ${index}`,
  logicalType: 'number',
  databaseType: 'BIGINT',
  nullable: true,
});

test('truncation preserves dataset identifiers and pagination metadata', () => {
  const datasets = [
    { id: 'ds_orders', name: 'Orders', rowCount: 10_194 },
    { id: 'ds_customers', name: 'Customers', rowCount: 793 },
  ];
  const output = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      datasets,
      visualizations: Array.from({ length: 20 }, (_, index) => ({ id: `viz_${index}`, title: 'x'.repeat(200) })),
      offset: 5,
      nextOffset: 10,
      columnsTotal: 21,
      rowsTotal: 10_194,
    }),
  );
  const parsed = JSON.parse(output) as Record<string, unknown>;

  expect(parsed['datasets']).toEqual(datasets);
  expect(parsed).toMatchObject({ offset: 5, nextOffset: 10, columnsTotal: 21, rowsTotal: 10_194, truncated: true });
});

test('oversized output remains valid JSON and carries a truncation marker', () => {
  const output = enforceOutputBudget(JSON.stringify({ ok: true, revision: 4, summary: 'x'.repeat(5000), rows: [] }));
  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(JSON.parse(output)).toMatchObject({ ok: true, revision: 4, truncated: true });
});

// Preserve schema columns when trimming oversized output so callers can still address fields.
test('a schema over budget keeps columns rather than degrading to its summary', () => {
  const output = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 5,
      summary: 'sample_superstore_data.csv has 21 columns and 10194 rows.',
      datasetId: 'ds_1f52b154-eed6-4750-b31d-3ed5695d1ce2',
      name: 'sample_superstore_data.csv',
      rowCount: 10194,
      columns: Array.from({ length: 21 }, (_, index) => column(index)),
    }),
  );
  const parsed = JSON.parse(output) as {
    columns?: unknown[];
    columnsTotal?: number;
    columnsReturned?: number;
    rowCount?: number;
  };

  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(parsed.columns?.length).toBeGreaterThan(0);
  expect(parsed.columnsTotal).toBe(21);
  expect(parsed.columnsReturned).toBe(parsed.columns?.length);
  // Identity fields survive so the agent can still address the dataset it asked about.
  expect(parsed.rowCount).toBe(10194);
});

test('wide tabular output narrows columns before sacrificing complete rows', () => {
  const output = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 5,
      summary: 'Returned 100 of 10194 rows.',
      columns: Array.from({ length: 6 }, (_, index) => column(index)),
      rows: Array.from({ length: 100 }, (_, index) => [index, `value ${index}`, index * 2]),
    }),
  );
  const parsed = JSON.parse(output) as { columns?: unknown[]; rows?: unknown[] };

  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(parsed.columns?.length).toBe(1);
  expect(parsed.rows?.length).toBe(100);
  expect(parsed.rows?.every((row) => Array.isArray(row) && row.length === 1)).toBe(true);
});

// An agent that reads only the summary would otherwise treat a narrowed projection as complete.
test('a narrowed projection is stated in the summary, not only in the counters', () => {
  const output = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 5,
      summary: 'Returned 100 of 10194 rows.',
      columns: Array.from({ length: 6 }, (_, index) => column(index)),
      rows: Array.from({ length: 100 }, (_, index) => [index, `value ${index}`, index * 2]),
    }),
  );
  const parsed = JSON.parse(output) as { summary?: string; columnsReturned?: number; columnsTotal?: number };

  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(parsed.columnsReturned).toBeLessThan(parsed.columnsTotal ?? 0);
  expect(parsed.summary).toContain(`Returned ${parsed.columnsReturned} of ${parsed.columnsTotal} requested columns`);
});

/*
 * The agent named these columns, so losing one costs a second call for a field it already requested.
 * Fewer rows still answer the question, and the row count is disclosed.
 */
test('an explicitly requested projection is preserved by dropping rows instead of columns', () => {
  const output = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 5,
      summary: 'Returned 100 of 10194 rows.',
      columnIds: ['col_region', 'col_sales'],
      rows: Array.from({ length: 100 }, (_, index) => [`Region ${index}`, index * 1.5]),
      rowsTotal: 10194,
      [PRESERVE_COLUMNS_KEY]: true,
    }),
  );
  const parsed = JSON.parse(output) as {
    columnIds?: string[];
    rows?: unknown[][];
    columnIdsReturned?: number;
    summary?: string;
  };

  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  // Both requested columns survive, and every returned row still carries both values.
  expect(parsed.columnIds).toEqual(['col_region', 'col_sales']);
  expect(parsed.columnIdsReturned).toBeUndefined();
  expect(parsed.rows?.every((row) => Array.isArray(row) && row.length === 2)).toBe(true);
  expect(parsed.rows?.length).toBeLessThan(100);
  expect(parsed.summary).toContain('rows');
});

test('the internal preserve hint never reaches the agent', () => {
  const withinBudget = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 1,
      summary: 'Returned 2 of 2 rows.',
      columnIds: ['a'],
      rows: [[1], [2]],
      [PRESERVE_COLUMNS_KEY]: true,
    }),
  );
  const overBudget = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 1,
      summary: 'Returned 100 of 10194 rows.',
      columnIds: ['col_region', 'col_sales'],
      rows: Array.from({ length: 100 }, (_, index) => [`Region ${index}`, index]),
      [PRESERVE_COLUMNS_KEY]: true,
    }),
  );

  expect(withinBudget).not.toContain(PRESERVE_COLUMNS_KEY);
  expect(overBudget).not.toContain(PRESERVE_COLUMNS_KEY);
  // Stripping the hint must leave the rest of a within-budget payload intact.
  expect(JSON.parse(withinBudget)).toMatchObject({ ok: true, revision: 1, rows: [[1], [2]] });
});

test('output that fits the budget keeps its summary untouched', () => {
  const payload = JSON.stringify({ ok: true, revision: 1, summary: 'Returned 5 of 10194 rows.', rows: [[1], [2]] });

  expect(enforceOutputBudget(payload)).toBe(payload);
});

test('a payload whose scalars alone exceed the budget still parses', () => {
  const output = enforceOutputBudget(
    JSON.stringify({ ok: false, code: 'UNSUPPORTED_OPERATION', error: 'y'.repeat(4000), rows: [1, 2, 3] }),
  );

  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(JSON.parse(output)).toMatchObject({ ok: false, code: 'UNSUPPORTED_OPERATION', truncated: true });
});

test('preview_data with columnIds narrows columns and preserves rows and rowsTotal', () => {
  const output = enforceOutputBudget(
    JSON.stringify({
      ok: true,
      revision: 1,
      summary: 'Returned 20 of 10194 rows.',
      columnIds: Array.from({ length: 21 }, (_, index) => `col_${index}`),
      rows: Array.from({ length: 20 }, (_row, r) => Array.from({ length: 21 }, (_cell, c) => `cell_${r}_${c}`)),
      rowsTotal: 10194,
    }),
  );
  const parsed = JSON.parse(output) as { columnIds?: string[]; rows?: unknown[][]; rowsTotal?: number };

  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(parsed.rows?.length).toBeGreaterThan(1);
  expect(parsed.rowsTotal).toBe(10194);
});
