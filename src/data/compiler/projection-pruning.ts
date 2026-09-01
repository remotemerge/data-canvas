import { filterColumnIds } from '@/data/compiler/filter-pushdown.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import { expressionColumnIds } from '@/domain/analysis/derived-expression.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Computes the physical columns a query reads, including through derived references.

// Collects query column IDs and the physical columns referenced by derived definitions.
export const referencedColumnIds = (
  query: AnalysisQuery,
  derivedColumns: Readonly<Record<EntityId, DerivedColumn>> = {},
): EntityId[] => {
  const seen = new Set<EntityId>();

  const visit = (columnId: EntityId): void => {
    if (seen.has(columnId)) {
      return;
    }

    const derived = derivedColumns[columnId];

    if (derived === undefined) {
      seen.add(columnId);

      return;
    }

    // Keep the derived ID because it is the ID present in the query.
    seen.add(columnId);
    for (const inner of expressionColumnIds(derived.expression)) {
      visit(inner);
    }
  };

  for (const columnId of query.dimensions) {
    visit(columnId);
  }
  for (const bin of query.binnedDimensions ?? []) {
    visit(bin.columnId);
  }
  for (const measure of query.measures) {
    if (measure.columnId !== undefined) {
      visit(measure.columnId);
    }
  }
  if (query.distribution !== undefined) {
    visit(query.distribution.columnId);
    if (query.distribution.categoryColumnId !== undefined) {
      visit(query.distribution.categoryColumnId);
    }
  }
  for (const sort of query.orderBy ?? []) {
    if (sort.columnId !== undefined) {
      visit(sort.columnId);
    }
  }
  for (const filter of query.filters) {
    for (const columnId of filterColumnIds(filter)) {
      visit(columnId);
    }
  }

  return [...seen];
};

// Returns whether the query uses the compiler's full-width projection.
export const isFullWidthProjection = (query: AnalysisQuery): boolean =>
  query.dimensions.length === 0 &&
  query.measures.length === 0 &&
  (query.binnedDimensions ?? []).length === 0 &&
  query.distribution === undefined;

// Returns columns for a narrower projection, or `undefined` when pruning is unsafe.
export const prunedProjection = (
  query: AnalysisQuery,
  requiredColumnIds: readonly EntityId[],
): EntityId[] | undefined => {
  if (!isFullWidthProjection(query)) {
    return undefined;
  }
  if (requiredColumnIds.length === 0) {
    return undefined;
  }

  return [...requiredColumnIds];
};
