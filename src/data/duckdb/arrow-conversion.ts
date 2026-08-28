/**
 * The single conversion point from Arrow values to plain JavaScript.
 *
 * Every row that leaves the engine passes through here. Centralizing it matters because the table
 * and the charts would otherwise each grow their own handling of `BigInt`, Arrow dates, and
 * timestamps, and would disagree — a value rendered one way in a cell and another on an axis is the
 * class of bug this module exists to prevent.
 *
 * Arrow types are structurally inspected rather than imported. The domain has no Arrow dependency,
 * and the values arriving here are already plain-ish: DuckDB-Wasm hands back `bigint` for integer
 * columns, `Date` for date columns, and numbers or strings elsewhere.
 */

/**
 * The value vocabulary the rest of the application sees.
 *
 * Temporal values become ISO strings rather than `Date` objects: they cross into the store, into
 * chart options, and into agent-facing payloads, and a `Date` serializes inconsistently across
 * those boundaries while an ISO string does not.
 */
export type CellValue = string | number | boolean | null;

/**
 * Beyond this magnitude a `bigint` cannot round-trip through `number`.
 *
 * DuckDB's `BIGINT` range exceeds JavaScript's safe integer range, so a large ID or a summed
 * counter can silently lose its low digits. Rather than corrupt the value, oversized integers
 * become their exact decimal string — readable in a cell, and never wrong.
 */
const MAX_EXACT_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_EXACT_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);

const convertBigInt = (value: bigint): CellValue =>
  value > MAX_EXACT_INTEGER || value < MIN_EXACT_INTEGER ? value.toString() : Number(value);

/**
 * Coerces whichever temporal representation DuckDB returned into a `Date`.
 *
 * Arrow does not hand back a uniform shape here. DuckDB-Wasm surfaces `DATE` and `TIMESTAMP`
 * columns as **epoch milliseconds** — a plain `number` for dates and a `bigint` for the wider
 * timestamp range — while some paths yield an actual `Date`. Without this normalization a date
 * column renders as `1732492800000` rather than `2024-11-25`.
 *
 * Returns `null` for anything not interpretable as an instant, so a malformed value becomes an
 * empty cell rather than `Invalid Date`.
 */
const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const epochMs = typeof value === 'bigint' ? Number(value) : value;

  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;

  const date = new Date(epochMs);

  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Formats a date-only value.
 *
 * The UTC portion of the ISO string is taken directly. Local-time getters would shift the day
 * backwards for anyone west of UTC, turning `2024-11-25` into `2024-11-24` for half the world.
 */
const toDateString = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * Converts one Arrow cell to a plain JavaScript value.
 *
 * Unrecognized shapes become strings rather than being passed through. An object reaching React or
 * ECharts unconverted would render as `[object Object]` or break a scale; a string is always
 * displayable and always safe, because every consumer renders it as plain text.
 */
export const convertArrowValue = (value: unknown): CellValue => {
  if (value === null || value === undefined) return null;

  const valueType = typeof value;

  if (valueType === 'boolean' || valueType === 'string') return value as boolean | string;

  // `NaN` and the infinities have no JSON representation and no meaningful axis position.
  if (valueType === 'number') return Number.isFinite(value) ? (value as number) : null;

  if (valueType === 'bigint') return convertBigInt(value as bigint);

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  // Arrow's binary and list vectors surface as typed arrays; they have no scalar meaning.
  if (ArrayBuffer.isView(value)) return null;

  return String(value);
};

/**
 * Converts a cell using its column's logical type.
 *
 * The type-blind path cannot recognize a temporal value at all when DuckDB returns it as epoch
 * milliseconds — a `DATE` would render as `1732492800000` and a `TIMESTAMP` as a bare number. The
 * logical type is what disambiguates a temporal column from a genuinely numeric one, and what
 * decides whether the result keeps a time component.
 */
export const convertArrowCell = (value: unknown, logicalType: string): CellValue => {
  if (logicalType === 'date' || logicalType === 'timestamp') {
    if (value === null || value === undefined) return null;

    const date = toDate(value);

    if (date === null) return convertArrowValue(value);

    return logicalType === 'date' ? toDateString(date) : date.toISOString();
  }

  return convertArrowValue(value);
};

/**
 * Reads one Arrow table into bounded rows of plain values.
 *
 * Structurally typed against Arrow's `Table` rather than importing it, keeping the Arrow dependency
 * inside the engine. `physicalNames` fixes column order: relying on the Arrow schema's order would
 * couple result shape to whatever DuckDB chose to emit.
 */
export interface ArrowRowSource {
  numRows: number;
  getChildAt(index: number): { get(index: number): unknown } | null;
  schema: { fields: readonly { name: string }[] };
}

export const readArrowRows = (
  table: ArrowRowSource,
  logicalTypes: readonly string[],
): { rows: CellValue[][]; rowCount: number } => {
  const fieldCount = table.schema.fields.length;
  const columns = Array.from({ length: fieldCount }, (_unused, index) => table.getChildAt(index));
  const rows: CellValue[][] = [];

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const row: CellValue[] = [];

    for (let columnIndex = 0; columnIndex < fieldCount; columnIndex += 1) {
      const column = columns[columnIndex];
      const logicalType = logicalTypes[columnIndex] ?? 'unknown';

      row.push(column === null || column === undefined ? null : convertArrowCell(column.get(rowIndex), logicalType));
    }

    rows.push(row);
  }

  return { rows, rowCount: table.numRows };
};

/**
 * Reads a single scalar from a one-row, one-column result.
 *
 * `COUNT(*)` returns a `BIGINT`, which arrives as a `bigint`; this is the one place that shape is
 * expected rather than incidental. A row count beyond the safe integer range would already have
 * exhausted browser memory long before, so the numeric coercion is safe here.
 */
export const readScalarCount = (table: ArrowRowSource): number => {
  if (table.numRows === 0) return 0;

  const value = convertArrowValue(table.getChildAt(0)?.get(0));

  return typeof value === 'number' ? value : Number(value ?? 0);
};
