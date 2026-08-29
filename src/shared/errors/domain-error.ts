/**
 * Stable machine-readable error codes.
 *
 * This union lists every code up front so new failure modes extend it rather than growing parallel
 * error vocabularies. Agents branch on `code`, so codes must stay stable once published.
 */
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
  /**
   * A persisted workspace cannot be brought to the current schema version — it was written by a
   * newer build, its version is unreadable, or no migration covers its version.
   *
   * Distinct from `UNSUPPORTED_OPERATION` because the corrective action differs: the workspace must
   * be left on disk untouched rather than retried or overwritten by a checkpoint.
   */
  | 'WORKSPACE_VERSION_UNSUPPORTED'
  | 'RESULT_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_OPERATION'
  | 'IMPORT_FAILED'
  | 'QUERY_FAILED'
  | 'ENGINE_UNAVAILABLE';

/**
 * Privacy constraint. Both `message` and `details` cross the agent boundary, so neither may
 * interpolate cell values, row contents, or file contents. Reference columns and entities by ID or
 * display name only.
 */
export interface DomainError {
  code: DomainErrorCode;
  /** Short corrective text; safe to surface to an agent. Must never contain dataset values. */
  message: string;
  details?: Record<string, unknown>;
}

export const domainError = (code: DomainErrorCode, message: string, details?: Record<string, unknown>): DomainError =>
  details === undefined ? { code, message } : { code, message, details };
