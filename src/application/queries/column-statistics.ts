import type { ColumnStatistics, DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { resolveDatasetColumn } from '@/application/validation/validate-entity-refs.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface ColumnProfile extends ColumnStatistics {
  columnId: EntityId;
  name: string;
  logicalType: string;
}

/**
 * Profiles one column against current workspace filters.
 *
 * The whole profile is aggregates plus a capped frequency list, so it answers questions like "which
 * columns suit a time series?" without previewing a single row. That is a better trade than wider
 * preview access: more analytical value, less raw data leaving the device.
 *
 * Filters are applied rather than ignored, so the profile describes the data the user is actually
 * looking at instead of the untouched import.
 */
export const getColumnProfile = async (
  engine: DataEnginePort,
  workspace: Workspace,
  datasetId: EntityId,
  columnId: EntityId,
  topValueLimit?: number,
): Promise<Result<ColumnProfile, DomainError>> => {
  const resolved = resolveDatasetColumn(workspace, datasetId, columnId);

  if (!resolved.ok) return resolved;

  const filters = Object.values(workspace.filters).filter((filter) => filter.datasetId === datasetId && filter.enabled);

  const statistics = await engine.getColumnStatistics({
    datasetId,
    columnId,
    filters,
    ...(topValueLimit === undefined ? {} : { topValueLimit }),
  });

  if (!statistics.ok) return statistics;

  return ok({
    ...statistics.value,
    columnId,
    name: resolved.value.column.name,
    logicalType: resolved.value.column.logicalType,
  });
};
