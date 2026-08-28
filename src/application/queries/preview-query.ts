import type { DataEnginePort, TableWindow } from '@/application/ports/data-engine-port.ts';
import { PREVIEW_ROW_LIMIT } from '@/data/import/import-limits.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * Reads the first rows of a dataset for the import preview.
 *
 * A read, not an action: it changes no state, so it does not go through the dispatcher. Keeping it
 * in the application layer is still what stops components from reaching the engine directly — the
 * port is the only thing this module knows about, and the port carries no DuckDB type.
 */
export const fetchPreview = (
  engine: DataEnginePort,
  datasetId: EntityId,
  signal?: AbortSignal,
): Promise<Result<TableWindow, DomainError>> =>
  engine.fetchTableWindow({
    datasetId,
    offset: 0,
    limit: PREVIEW_ROW_LIMIT,
    ...(signal === undefined ? {} : { signal }),
  });
