import type { DataEnginePort, TableWindow } from '@/application/ports/data-engine-port.ts';
import { PREVIEW_ROW_LIMIT } from '@/data/import/import-limits.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { Result } from '@/shared/result/result.ts';

// Reads a bounded preview through the application engine port without changing workspace state.
export const fetchPreview = (
  engine: DataEnginePort,
  datasetId: EntityId,
  signal?: AbortSignal,
): Promise<Result<TableWindow, DomainError>> =>
  engine.fetchTableWindow({
    datasetId,
    offset: 0,
    limit: PREVIEW_ROW_LIMIT,
    filters: [],
    ...(signal === undefined ? {} : { signal }),
  });
