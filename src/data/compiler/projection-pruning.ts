import { filterColumnIds } from '@/data/compiler/filter-pushdown.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import { expressionColumnIds } from '@/domain/analysis/derived-expression.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * Works out which columns a query genuinely reads.
 *
 * The win is on wide relations. A bare projection — a query with no dimensions and no measures —
 * currently selects every column of the anchor, which on a 200-column dataset moves roughly forty
 * times more data across the Arrow boundary than a table view of five visible columns needs.
 *
 * This module only computes the set. The planner writes it back onto the query as explicit
 * dimensions, so the compiler still decides what SQL each column becomes.
 */

/**
 * Every column ID the query names, following derived references down to physical columns.
 *
 * A derived column belongs to no relation: its ID never resolves to something selectable, so the
 * expression it wraps has to be walked to find the columns actually read.
 */
export const referencedColumnIds = (
  query: AnalysisQuery,
  derivedColumns: Readonly<Record<EntityId, DerivedColumn>> = {},
): EntityId[] => {
  const seen = new Set<EntityId>();

  const visit = (columnId: EntityId): void => {
    if (seen.has(columnId)) return;

    const derived = derivedColumns[columnId];

    if (derived === undefined) {
      seen.add(columnId);

      return;
    }

    // The derived ID is recorded too. It is what the query references, and the planner compares
    // against the query's own IDs rather than against physical ones.
    seen.add(columnId);
    for (const inner of expressionColumnIds(derived.expression)) visit(inner);
  };

  for (const columnId of query.dimensions) visit(columnId);
  for (const bin of query.binnedDimensions ?? []) visit(bin.columnId);
  for (const measure of query.measures) if (measure.columnId !== undefined) visit(measure.columnId);
  if (query.distribution !== undefined) {
    visit(query.distribution.columnId);
    if (query.distribution.categoryColumnId !== undefined) visit(query.distribution.categoryColumnId);
  }
  for (const sort of query.orderBy ?? []) if (sort.columnId !== undefined) visit(sort.columnId);
  for (const filter of query.filters) for (const columnId of filterColumnIds(filter)) visit(columnId);

  return [...seen];
};

/**
 * True when the query would compile to a full-width projection.
 *
 * That is the only case pruning applies to. A query that already names its dimensions and measures
 * selects exactly those, so there is nothing to prune and rewriting it would change the result.
 */
export const isFullWidthProjection = (query: AnalysisQuery): boolean =>
  query.dimensions.length === 0 &&
  query.measures.length === 0 &&
  (query.binnedDimensions ?? []).length === 0 &&
  query.distribution === undefined;

/**
 * The columns a full-width projection can be narrowed to.
 *
 * `undefined` when narrowing is not applicable or would change the result: a bare projection with no
 * required columns at all is a genuine "show me everything" request, which the table view makes, and
 * pruning it to nothing would return empty rows.
 */
export const prunedProjection = (
  query: AnalysisQuery,
  requiredColumnIds: readonly EntityId[],
): EntityId[] | undefined => {
  if (!isFullWidthProjection(query)) return undefined;
  if (requiredColumnIds.length === 0) return undefined;

  return [...requiredColumnIds];
};
