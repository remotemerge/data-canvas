import type { QueryContext, QueryDataset } from '@/data/compiler/compile-analysis-query.ts';
import { canPushDown, simplifyFilter } from '@/data/compiler/filter-pushdown.ts';
import { orderJoinTargets } from '@/data/compiler/join-ordering.ts';
import type { DatasetCardinality } from '@/data/compiler/join-ordering.ts';
import { prunedProjection, referencedColumnIds } from '@/data/compiler/projection-pruning.ts';
import { datasetIdsForColumns } from '@/data/compiler/resolve-join-path.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Rewrites an analysis query into an equivalent form that can execute more cheaply.

export interface PlannedQuery {
  query: AnalysisQuery;
  // Non-anchor datasets ordered for the FROM/JOIN chain.
  joinOrder?: EntityId[];
  // Planner changes recorded for tests and performance reporting.
  applied: PlannerOptimization[];
}

export type PlannerOptimization = 'filter-simplification' | 'filter-pushdown' | 'projection-pruning' | 'join-ordering';

export interface PlannerContext extends QueryContext {
  // Estimated row counts from the statistics cache.
  cardinalities?: readonly DatasetCardinality[];
}

// Finds datasets that may be null-extended by a participating join.
const nullExtendedDatasets = (relationships: readonly Relationship[], anchorId: EntityId): Set<EntityId> => {
  const extended = new Set<EntityId>();

  for (const relationship of relationships) {
    if (relationship.join !== 'left') {
      continue;
    }

    // The FROM anchor is preserved by definition.
    if (relationship.leftDatasetId !== anchorId) {
      extended.add(relationship.leftDatasetId);
    }
    if (relationship.rightDatasetId !== anchorId) {
      extended.add(relationship.rightDatasetId);
    }
  }

  return extended;
};

const columnOwner =
  (datasets: readonly QueryDataset[]) =>
  (columnId: EntityId): EntityId | undefined =>
    datasets.find((dataset) => dataset.columns.some((column) => column.id === columnId))?.id;

// Classifies filters as safe or unsafe to push below a join.
export interface FilterPartition {
  pushable: FilterExpression[];
  retained: FilterExpression[];
}

export const partitionFilters = (
  filters: readonly FilterExpression[],
  context: PlannerContext,
  anchorId: EntityId,
): FilterPartition => {
  const extended = nullExtendedDatasets(context.relationships ?? [], anchorId);
  const ownerOf = columnOwner(context.datasets);
  const pushable: FilterExpression[] = [];
  const retained: FilterExpression[] = [];

  for (const filter of filters) {
    if (canPushDown(filter, extended, ownerOf)) {
      pushable.push(filter);
    } else {
      retained.push(filter);
    }
  }

  return { pushable, retained };
};

// Plans one query by simplifying, pruning, and ordering its work.
export const planQuery = (query: AnalysisQuery, context: PlannerContext): PlannedQuery => {
  const applied: PlannerOptimization[] = [];
  let planned = query;

  const simplified = query.filters.map(simplifyFilter);

  if (JSON.stringify(simplified) !== JSON.stringify(query.filters)) {
    planned = { ...planned, filters: simplified };
    applied.push('filter-simplification');
  }

  // Record the classification; the compiler emits one WHERE conjunction.
  const partition = partitionFilters(planned.filters, context, query.datasetId);

  if (partition.pushable.length > 0) {
    applied.push('filter-pushdown');
  }

  const required = referencedColumnIds(planned, context.derivedColumns ?? {});
  const pruned = prunedProjection(planned, required);

  if (pruned !== undefined) {
    planned = { ...planned, dimensions: pruned };
    applied.push('projection-pruning');
  }

  let joinOrder: EntityId[] | undefined;

  if ((context.cardinalities ?? []).length > 0 && (context.relationships ?? []).length > 0) {
    const targets = datasetIdsForColumns(
      referencedColumnIds(planned, context.derivedColumns ?? {}),
      context.datasets,
    ).filter((datasetId) => datasetId !== query.datasetId);
    const ordered = orderJoinTargets(targets, context.cardinalities ?? []);

    // Report only when the order changed.
    if (ordered.length > 1 && JSON.stringify(ordered) !== JSON.stringify(targets)) {
      joinOrder = ordered;
      applied.push('join-ordering');
    }
  }

  return { query: planned, ...(joinOrder === undefined ? {} : { joinOrder }), applied };
};
