import type { EntityId } from '@/shared/ids/entity-id.ts';

// Orders required non-anchor datasets by estimated row count.

export interface DatasetCardinality {
  datasetId: EntityId;
  // Estimated rows; unknown datasets sort last.
  rowCount?: number;
}

// Sorts non-anchor datasets by estimated row count while preserving unknowns.
export const orderJoinTargets = (
  requiredDatasetIds: readonly EntityId[],
  cardinalities: readonly DatasetCardinality[],
): EntityId[] => {
  const rowCountOf = new Map<EntityId, number>();

  for (const entry of cardinalities) {
    if (entry.rowCount !== undefined) {
      rowCountOf.set(entry.datasetId, entry.rowCount);
    }
  }

  const known = requiredDatasetIds.filter((datasetId) => rowCountOf.has(datasetId));
  const unknown = requiredDatasetIds.filter((datasetId) => !rowCountOf.has(datasetId));

  // Sort only known estimates so unknown datasets keep their input order.
  const sorted = known.toSorted((left, right) => (rowCountOf.get(left) as number) - (rowCountOf.get(right) as number));

  return [...sorted, ...unknown];
};
