import type { BinStrategy, ColumnRange } from '@/domain/analysis/bin-strategy.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export interface MeasureSpec {
  // Omitted for `count`, which aggregates rows.
  columnId?: EntityId;
  aggregate: AggregateFunction;
  // Display label; never used as a SQL identifier.
  alias?: string;
  modifier?: MetricModifier;
}

// Dimension bucketed before grouping; the caller supplies its range.
export interface BinnedDimensionSpec {
  columnId: EntityId;
  strategy: BinStrategy;
  range?: ColumnRange;
}

export interface DistributionSpec {
  columnId: EntityId;
  categoryColumnId?: EntityId;
}

export interface SortSpec {
  // Grouped dimension column or measure alias from this query.
  columnId?: EntityId;
  measureAlias?: string;
  direction: 'asc' | 'desc';
}

export interface AnalysisQuery {
  datasetId: EntityId;
  relationshipIds?: EntityId[];
  // Column IDs may belong to the anchor or a reachable dataset.
  dimensions: EntityId[];
  binnedDimensions?: BinnedDimensionSpec[];
  measures: MeasureSpec[];
  distribution?: DistributionSpec;
  filters: FilterExpression[];
  orderBy?: SortSpec[];
  limit?: number;
  offset?: number;
}
