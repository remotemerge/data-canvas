import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * Orders the datasets a query must reach, most selective first.
 *
 * What this can and cannot do. The relationship graph is a forest — cycles are rejected at creation
 * — so the path from the anchor to any dataset is unique and its *internal* order is fixed: a step
 * cannot run before the step that brought its source into the chain. What remains free is the order
 * the query's target datasets are resolved in, which decides which branch enters the FROM clause
 * first. Putting the smallest relation first lets DuckDB build its hash table on fewer rows.
 *
 * A pure reordering of the target list. It never adds, drops, or redirects a join, so the result set
 * is identical by construction rather than by testing — though the planner equivalence tests check
 * it anyway.
 */

export interface DatasetCardinality {
  datasetId: EntityId;
  /** Estimated rows. Absent when unknown, which sorts last rather than being guessed at. */
  rowCount?: number;
}

/**
 * Sorts required datasets by estimated row count, ascending.
 *
 * A dataset with no estimate keeps its relative position at the end: ordering it by a fabricated
 * number would be worse than leaving it where the caller put it, because a wrong estimate can make
 * the plan worse than no plan.
 *
 * The anchor is excluded by the caller — it is always first in the FROM clause by definition.
 */
export const orderJoinTargets = (
  requiredDatasetIds: readonly EntityId[],
  cardinalities: readonly DatasetCardinality[],
): EntityId[] => {
  const rowCountOf = new Map<EntityId, number>();

  for (const entry of cardinalities) {
    if (entry.rowCount !== undefined) rowCountOf.set(entry.datasetId, entry.rowCount);
  }

  const known = requiredDatasetIds.filter((datasetId) => rowCountOf.has(datasetId));
  const unknown = requiredDatasetIds.filter((datasetId) => !rowCountOf.has(datasetId));

  // `toSorted` on the known subset only, so the unknown ones keep the caller's order verbatim.
  const sorted = known.toSorted((left, right) => (rowCountOf.get(left) as number) - (rowCountOf.get(right) as number));

  return [...sorted, ...unknown];
};
