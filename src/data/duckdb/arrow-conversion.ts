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
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const epochMs = typeof value === 'bigint' ? Number(value) : value;

  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) {
    return null;
  }

  const date = new Date(epochMs);

  return Number.isNaN(date.getTime()) ? null : date;
};

// Formats a date-only value in UTC to avoid local-time shifts.
const toDateString = (value: Date): string => value.toISOString().slice(0, 10);

// Decodes a 128-bit little-endian two's complement integer (HugeInt / Decimal128).
const decodeHugeInt = (view: ArrayBufferView): bigint => {
  const u32 = new Uint32Array(view.buffer, view.byteOffset, 4);
  const low = BigInt(u32[0]!) | (BigInt(u32[1]!) << 32n);
  const highUnsigned = BigInt(u32[2]!) | (BigInt(u32[3]!) << 32n);
  const isNegative = (u32[3]! & 0x80000000) !== 0;
  if (isNegative) {
    const highSigned = highUnsigned - (1n << 64n);
    return (highSigned << 64n) | low;
  }
  return (highUnsigned << 64n) | low;
};

// Converts one Arrow cell to a JSON-safe scalar.
export const convertArrowValue = (value: unknown): CellValue => {
  if (value === null || value === undefined) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === 'boolean' || valueType === 'string') {
    return value as boolean | string;
  }

  // NaN and infinities have no JSON representation or useful axis position.
  if (valueType === 'number') {
    return Number.isFinite(value) ? (value as number) : null;
  }

  if (valueType === 'bigint') {
    return convertBigInt(value as bigint);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (ArrayBuffer.isView(value)) {
    if (value.byteLength === 16) {
      return convertBigInt(decodeHugeInt(value));
    }
    if (value.byteLength === 8) {
      const i64 = new BigInt64Array(value.buffer, value.byteOffset, 1)[0]!;
      return convertBigInt(i64);
    }
    // 32-bit integer types that DuckDB may emit for aggregate results fitting within INT32.
    if (value.byteLength === 4) {
      const i32 = new Int32Array(value.buffer, value.byteOffset, 1)[0]!;
      return Number(i32);
    }
    return null;
  }

  return String(value);
};

// Converts a cell using its logical type, including temporal epoch values.
export const convertArrowCell = (value: unknown, logicalType: string): CellValue => {
  if (logicalType === 'date' || logicalType === 'timestamp') {
    if (value === null || value === undefined) {
      return null;
    }

    const date = toDate(value);

    if (date === null) {
      return convertArrowValue(value);
    }

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
  if (table.numRows === 0) {
    return 0;
  }

  const value = convertArrowValue(table.getChildAt(0)?.get(0));

  return typeof value === 'number' ? value : Number(value ?? 0);
};
