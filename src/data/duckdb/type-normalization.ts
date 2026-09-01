import type { LogicalType } from '@/domain/logical-type.ts';

// Maps DuckDB physical types to domain logical types.

// Exact physical type names after normalization.
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

// Removes type parameters before lookup.
const stripParameters = (databaseType: string): string => {
  const openParen = databaseType.indexOf('(');

  return (openParen === -1 ? databaseType : databaseType.slice(0, openParen)).trim();
};

// Maps a normalized DuckDB type to a `LogicalType`.
export const normalizeLogicalType = (databaseType: string): LogicalType => {
  const normalized = stripParameters(databaseType).toUpperCase();

  // Lists and arrays are not scalar domain values.
  if (normalized.endsWith('[]')) {
    return 'unknown';
  }

  return EXACT_TYPES[normalized] ?? 'unknown';
};

// Distinct-value threshold for classifying text as category.
export const CATEGORY_DISTINCT_THRESHOLD = 50;

// Refines a string column to category when its capped distinct count is low.
export const refineTextType = (logicalType: LogicalType, distinctCount: number): LogicalType =>
  logicalType === 'string' && distinctCount <= CATEGORY_DISTINCT_THRESHOLD ? 'category' : logicalType;
