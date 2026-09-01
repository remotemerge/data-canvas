// Stable error codes used by callers and agents.
export type DomainErrorCode =
  | 'INVALID_TOOL_ARGUMENTS'
  | 'DATASET_NOT_FOUND'
  | 'COLUMN_NOT_FOUND'
  | 'VISUALIZATION_NOT_FOUND'
  | 'FILTER_NOT_FOUND'
  | 'INCOMPATIBLE_COLUMN'
  | 'NO_JOIN_PATH'
  | 'RELATIONSHIP_CYCLE'
  | 'DATASET_IN_USE'
  | 'STALE_WORKSPACE_REVISION'
  // Persisted workspace cannot be loaded by this schema version.
  | 'WORKSPACE_VERSION_UNSUPPORTED'
  | 'RESULT_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_OPERATION'
  | 'IMPORT_FAILED'
  | 'QUERY_FAILED'
  | 'ENGINE_UNAVAILABLE';

// Error payload safe to cross the agent boundary.
export interface DomainError {
  code: DomainErrorCode;
  // Short corrective text that must not contain dataset values.
  message: string;
  details?: Record<string, unknown>;
}

export const domainError = (code: DomainErrorCode, message: string, details?: Record<string, unknown>): DomainError =>
  details === undefined ? { code, message } : { code, message, details };
