// Domain logical types after DuckDB type normalization.
export type LogicalType = 'number' | 'string' | 'boolean' | 'date' | 'timestamp' | 'category' | 'unknown';

export const LOGICAL_TYPES: readonly LogicalType[] = [
  'number',
  'string',
  'boolean',
  'date',
  'timestamp',
  'category',
  'unknown',
] as const;

export const isNumericType = (t: LogicalType): boolean => t === 'number';

export const isTemporalType = (t: LogicalType): boolean => t === 'date' || t === 'timestamp';

export const isTextType = (t: LogicalType): boolean => t === 'string' || t === 'category';
