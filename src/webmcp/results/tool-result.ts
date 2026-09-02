import type { DomainError } from '@/shared/errors/domain-error.ts';

export const successResult = (result: { revision: number; summary: string; [key: string]: unknown }): string =>
  JSON.stringify({ ok: true, ...result });

/*
 * Recovery hints per error code, phrased as the next call to make.
 *
 * An agent that cannot read tool descriptors sees only this envelope, so a failure that names no
 * remedy costs a speculative retry. Text stays free of dataset values.
 */
const RECOVERY_HINT: Readonly<Partial<Record<DomainError['code'], string>>> = {
  INVALID_TOOL_ARGUMENTS: 'Fix the named argument and call again.',
  DATASET_NOT_FOUND: 'Call get_workspace to list valid dataset IDs.',
  COLUMN_NOT_FOUND: 'Call get_dataset_schema for the valid column IDs of this dataset.',
  VISUALIZATION_NOT_FOUND: 'Call get_workspace to list current visualization IDs.',
  FILTER_NOT_FOUND: 'Call get_workspace to list current filter IDs.',
  INCOMPATIBLE_COLUMN: 'Call get_column_statistics to check the column type, then pick a compatible column.',
  NO_JOIN_PATH:
    'Call list_relationships with includeSuggestions=true, then call create_relationship if no suitable path exists.',
  RELATIONSHIP_CYCLE: 'Call list_relationships to inspect existing joins before relating these datasets.',
  STALE_WORKSPACE_REVISION: 'Retry with the currentRevision from details, or omit expectedRevision.',
  RESULT_LIMIT_EXCEEDED: 'Lower limit, or add dimensions and filters to narrow the result.',
  ENGINE_UNAVAILABLE: 'The data engine is still starting; retry shortly.',
};

/*
 * `details` carries the machine-readable half of a recoverable failure, such as the currentRevision
 * a stale write should retry against. Dropping it forces a redundant discovery call.
 */
export const errorResult = (error: DomainError): string =>
  JSON.stringify({
    ok: false,
    code: error.code,
    error: error.message,
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(RECOVERY_HINT[error.code] === undefined ? {} : { recovery: RECOVERY_HINT[error.code] }),
  });
