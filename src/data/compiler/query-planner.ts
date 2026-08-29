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

/**
 * The planning pass between validation and compilation.
 *
 * It rewrites an `AnalysisQuery` into an equivalent one that compiles to cheaper SQL. Two rules make
 * this safe to have at all:
 *
 * 1. **It operates on the AST and never on SQL text.** The compiler stays the only code that
 *    produces a statement, so the injection guarantees are untouched by anything here.
 * 2. **Every rewrite preserves the result set.** A planner that changes answers is a defect, not an
 *    optimization, which is why `tests/unit/data/planner-equivalence.test.ts` compiles both the
 *    planned and unplanned form of every fixture and compares the rows.
 *
 * When a rewrite cannot be proven safe the planner leaves the query alone. Declining to optimize
 * costs a slower query; optimizing wrongly costs a wrong answer.
 */

export interface PlannedQuery {
  query: AnalysisQuery;
  /**
   * Non-anchor datasets in the order they should enter the FROM/JOIN chain, smallest first.
   *
   * Separate from the query rather than written into it because join order is a physical-plan
   * decision, not part of what the query asks for. The compiler consumes it as a hint; a query
   * compiled without it produces the same rows in the same order, only via a different plan.
   */
  joinOrder?: EntityId[];
  /** What the planner actually changed, for tests and for the performance report. */
  applied: PlannerOptimization[];
}

export type PlannerOptimization = 'filter-simplification' | 'filter-pushdown' | 'projection-pruning' | 'join-ordering';

export interface PlannerContext extends QueryContext {
  /** Estimated row counts per dataset, from the statistics cache. Absent entries are not guessed. */
  cardinalities?: readonly DatasetCardinality[];
}

/**
 * Datasets that a join would null-extend, so a filter on them must not be pushed below it.
 *
 * Computed from the relationships that could participate rather than from a resolved path, because
 * the planner runs before path resolution. Being conservative here is deliberate: naming a dataset
 * null-extended when it turns out not to be only forgoes an optimization, whereas missing one would
 * change results across a `left` join.
 *
 * For a `left` relationship the preserved side is whichever dataset the chain reaches first, so both
 * sides are treated as potentially null-extended unless the relationship is `inner`.
 */
const nullExtendedDatasets = (relationships: readonly Relationship[], anchorId: EntityId): Set<EntityId> => {
  const extended = new Set<EntityId>();

  for (const relationship of relationships) {
    if (relationship.join !== 'left') continue;

    // The anchor is never null-extended: it is the relation the FROM clause starts from, and a left
    // join preserves it by definition.
    if (relationship.leftDatasetId !== anchorId) extended.add(relationship.leftDatasetId);
    if (relationship.rightDatasetId !== anchorId) extended.add(relationship.rightDatasetId);
  }

  return extended;
};

const columnOwner =
  (datasets: readonly QueryDataset[]) =>
  (columnId: EntityId): EntityId | undefined =>
    datasets.find((dataset) => dataset.columns.some((column) => column.id === columnId))?.id;

/**
 * Splits filters into those safe to evaluate before the join and those that must wait.
 *
 * The split is currently informational: the compiler emits one `WHERE` clause, and DuckDB's own
 * optimizer pushes a single-relation predicate below the join without help. What the planner adds is
 * the *guarantee* — it records which predicates were provably pushable, so the equivalence test can
 * assert that a `left`-join right-side filter was correctly declined.
 */
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
    if (canPushDown(filter, extended, ownerOf)) pushable.push(filter);
    else retained.push(filter);
  }

  return { pushable, retained };
};

/**
 * Plans one query.
 *
 * Order matters: simplification runs first so pushdown analysis sees the merged predicates, and
 * pruning runs before ordering so the required-dataset set reflects the narrowed projection.
 */
export const planQuery = (query: AnalysisQuery, context: PlannerContext): PlannedQuery => {
  const applied: PlannerOptimization[] = [];
  let planned = query;

  const simplified = query.filters.map(simplifyFilter);

  if (JSON.stringify(simplified) !== JSON.stringify(query.filters)) {
    planned = { ...planned, filters: simplified };
    applied.push('filter-simplification');
  }

  // Recorded rather than reordered. The compiler emits a single conjunction, so moving a pushable
  // predicate earlier in the list changes nothing it produces; the analysis exists so that a
  // predicate which must *not* move is provably identified.
  const partition = partitionFilters(planned.filters, context, query.datasetId);

  if (partition.pushable.length > 0) applied.push('filter-pushdown');

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

    // Only reported when the order actually changed, so the report never claims work it skipped.
    if (ordered.length > 1 && JSON.stringify(ordered) !== JSON.stringify(targets)) {
      joinOrder = ordered;
      applied.push('join-ordering');
    }
  }

  return { query: planned, ...(joinOrder === undefined ? {} : { joinOrder }), applied };
};
