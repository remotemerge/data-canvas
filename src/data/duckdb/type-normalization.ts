import type { LogicalType } from '@/domain/logical-type.ts';

/**
 * Collapses DuckDB's physical type vocabulary onto the domain's `LogicalType`.
 *
 * The domain deliberately knows fewer types than the engine so operator compatibility and
 * visual-channel rules stay decidable. `Column.databaseType` retains the true physical type, so the
 * query compiler never has to reconstruct what was collapsed here.
 */

/**
 * Exact physical types, matched after parameter stripping and uppercasing.
 *
 * A lookup table rather than a chain of `includes` checks: substring matching would classify
 * `VARCHAR` inside a `STRUCT(a VARCHAR)` as a string, when a struct is genuinely `unknown` to the
 * domain.
 */
const EXACT_TYPES: Readonly<Record<string, LogicalType>> = {
  TINYINT: 'number',
  SMALLINT: 'number',
  INTEGER: 'number',
  BIGINT: 'number',
  HUGEINT: 'number',
  UTINYINT: 'number',
  USMALLINT: 'number',
  UINTEGER: 'number',
  UBIGINT: 'number',
  UHUGEINT: 'number',
  FLOAT: 'number',
  REAL: 'number',
  DOUBLE: 'number',
  DECIMAL: 'number',
  NUMERIC: 'number',

  VARCHAR: 'string',
  CHAR: 'string',
  BPCHAR: 'string',
  TEXT: 'string',
  STRING: 'string',
  UUID: 'string',

  BOOLEAN: 'boolean',
  BOOL: 'boolean',

  DATE: 'date',

  TIMESTAMP: 'timestamp',
  DATETIME: 'timestamp',
  'TIMESTAMP WITH TIME ZONE': 'timestamp',
  TIMESTAMPTZ: 'timestamp',
  TIMESTAMP_S: 'timestamp',
  TIMESTAMP_MS: 'timestamp',
  TIMESTAMP_NS: 'timestamp',
};

/**
 * Strips the parameter list from a parameterized type.
 *
 * `DECIMAL(18,3)` and `VARCHAR(255)` differ only in precision, which the domain does not model, so
 * both collapse to their base type. Nested types such as `STRUCT(...)` keep their base name too and
 * fall through to `unknown`, which is the correct answer for them.
 */
const stripParameters = (databaseType: string): string => {
  const openParen = databaseType.indexOf('(');

  return (openParen === -1 ? databaseType : databaseType.slice(0, openParen)).trim();
};

/**
 * Maps a DuckDB physical type onto a `LogicalType`.
 *
 * `category` is never produced here. It is a low-cardinality refinement of `string` that no
 * physical type can express, so it is decided by a bounded distinct count during import.
 */
export const normalizeLogicalType = (databaseType: string): LogicalType => {
  const normalized = stripParameters(databaseType).toUpperCase();

  // Arrays and lists carry an element type the domain cannot represent as a scalar column.
  if (normalized.endsWith('[]')) return 'unknown';

  return EXACT_TYPES[normalized] ?? 'unknown';
};

/**
 * Distinct-value ceiling below which a text column counts as categorical.
 *
 * Categories drive axis grouping and colour channels, both of which degrade badly past a few dozen
 * members, so the threshold reflects what is legible in a chart rather than a statistical rule.
 */
export const CATEGORY_DISTINCT_THRESHOLD = 50;

/**
 * Refines a `string` column to `category` when its distinct count is low enough.
 *
 * `distinctCount` comes from a query capped just above the threshold, so a column with a million
 * distinct values costs the same as one with fifty. Only `string` is refined: refining a number
 * would let a low-cardinality numeric column lose its arithmetic operators.
 */
export const refineTextType = (logicalType: LogicalType, distinctCount: number): LogicalType =>
  logicalType === 'string' && distinctCount <= CATEGORY_DISTINCT_THRESHOLD ? 'category' : logicalType;
