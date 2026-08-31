/**
 * Converts DuckDB-Wasm and Arrow values to plain JavaScript values.
 *
 * Every row leaving the engine uses this module, so tables and charts share bigint and temporal
 * conversion rules.
 */

// Values returned to the application. Temporal values use ISO strings for stable serialization.
export type CellValue = string | number | boolean | null;

// Safe integer limit; larger bigint values remain decimal strings to preserve precision.
const MAX_EXACT_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_EXACT_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);

const convertBigInt = (value: bigint): CellValue =>
  value > MAX_EXACT_INTEGER || value < MIN_EXACT_INTEGER ? value.toString() : Number(value);

// Normalizes DuckDB temporal values to a `Date`, or `null` when the value is invalid.
const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const epochMs = typeof value === 'bigint' ? Number(value) : value;

  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;

  const date = new Date(epochMs);

  return Number.isNaN(date.getTime()) ? null : date;
};

// Formats a date-only value in UTC to avoid local-time shifts.
const toDateString = (value: Date): string => value.toISOString().slice(0, 10);

// Converts one Arrow cell to a JSON-safe scalar.
export const convertArrowValue = (value: unknown): CellValue => {
  if (value === null || value === undefined) return null;

  const valueType = typeof value;

  if (valueType === 'boolean' || valueType === 'string') return value as boolean | string;

  // NaN and infinities have no JSON representation or useful axis position.
  if (valueType === 'number') return Number.isFinite(value) ? (value as number) : null;

  if (valueType === 'bigint') return convertBigInt(value as bigint);

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  // Binary and list vectors do not have a scalar representation for table cells.
  if (ArrayBuffer.isView(value)) return null;

  return String(value);
};

// Converts a cell using its logical type, including temporal epoch values.
export const convertArrowCell = (value: unknown, logicalType: string): CellValue => {
  if (logicalType === 'date' || logicalType === 'timestamp') {
    if (value === null || value === undefined) return null;

    const date = toDate(value);

    if (date === null) return convertArrowValue(value);

    return logicalType === 'date' ? toDateString(date) : date.toISOString();
  }

  return convertArrowValue(value);
};

// Reads an Arrow table into bounded plain rows in the requested column order.
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

// Reads a scalar from a one-row, one-column result.
export const readScalarCount = (table: ArrowRowSource): number => {
  if (table.numRows === 0) return 0;

  const value = convertArrowValue(table.getChildAt(0)?.get(0));

  return typeof value === 'number' ? value : Number(value ?? 0);
};
