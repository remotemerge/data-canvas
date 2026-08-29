import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export interface MeasureSpec {
  /** Omitted for `count`, which aggregates rows rather than a column. */
  columnId?: EntityId;
  aggregate: AggregateFunction;
  /** Output column label; display-only, never used as a SQL identifier. */
  alias?: string;
}

export interface SortSpec {
  /** Either a grouped dimension column or a measure alias produced by this same query. */
  columnId?: EntityId;
  measureAlias?: string;
  direction: 'asc' | 'desc';
}

/**
 * AST-like analysis contract.
 *
 * This is the only shape the query compiler accepts. Agent input becomes an `AnalysisQuery` after
 * validation and never becomes SQL text directly.
 */
export interface AnalysisQuery {
  /** The anchor dataset. Joined datasets are reached through `relationshipIds`. */
  datasetId: EntityId;
  /**
   * Relationships to traverse from the anchor.
   *
   * Omitted lets the compiler resolve the path from the referenced columns, which is what keeps an
   * agent from having to name a join it only implied. Supplied, it constrains the path.
   */
  relationshipIds?: EntityId[];
  /** Column IDs may belong to the anchor dataset or to any dataset reachable through a join. */
  dimensions: EntityId[];
  measures: MeasureSpec[];
  filters: FilterExpression[];
  orderBy?: SortSpec[];
  limit?: number;
  offset?: number;
}
