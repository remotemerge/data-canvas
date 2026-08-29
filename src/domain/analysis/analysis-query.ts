import type { BinStrategy, ColumnRange } from '@/domain/analysis/bin-strategy.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export interface MeasureSpec {
  /** Omitted for `count`, which aggregates rows rather than a column. */
  columnId?: EntityId;
  aggregate: AggregateFunction;
  /** Output column label; display-only, never used as a SQL identifier. */
  alias?: string;
  /**
   * Window transformation applied over the aggregate. Absent leaves a plain aggregate, so a query
   * written before modifiers existed compiles unchanged.
   */
  modifier?: MetricModifier;
}

/**
 * A dimension that is bucketed before grouping.
 *
 * `range` is supplied by the caller because `equalWidth` needs the column's extent and reading it
 * requires a query. Keeping the read outside the compiler leaves compilation synchronous and lets
 * the caller cache the range against the dataset revision.
 */
export interface BinnedDimensionSpec {
  columnId: EntityId;
  strategy: BinStrategy;
  range?: ColumnRange;
}

/** The five-number summary a box plot needs, computed with `quantile_cont` in DuckDB. */
export interface DistributionSpec {
  columnId: EntityId;
  /** Optional low-cardinality grouping, one box per value. */
  categoryColumnId?: EntityId;
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
  /**
   * Dimensions bucketed before grouping, emitted after the plain ones.
   *
   * Separate from `dimensions` because a bin carries a strategy, and widening `dimensions` to a
   * union would force every existing caller to narrow before reading a column ID.
   */
  binnedDimensions?: BinnedDimensionSpec[];
  measures: MeasureSpec[];
  /** Replaces `measures` with a five-number summary. Only `boxplot` sets it. */
  distribution?: DistributionSpec;
  filters: FilterExpression[];
  orderBy?: SortSpec[];
  limit?: number;
  offset?: number;
}
