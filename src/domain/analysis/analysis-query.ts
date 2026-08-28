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
  datasetId: EntityId;
  dimensions: EntityId[];
  measures: MeasureSpec[];
  filters: FilterExpression[];
  orderBy?: SortSpec[];
  limit?: number;
}
