/**
 * Normalized logical column types. DuckDB's physical type vocabulary is much larger. The domain
 * collapses it on purpose so operator compatibility and visual-channel rules stay decidable.
 */
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
