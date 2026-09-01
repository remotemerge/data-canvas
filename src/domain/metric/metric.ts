import type { MetricDirection, MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export type AggregateFunction = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'median' | 'stddev';

export const AGGREGATE_FUNCTIONS: readonly AggregateFunction[] = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'median',
  'stddev',
] as const;

export interface MetricFormat {
  style: 'plain' | 'decimal' | 'percent' | 'currency';
  // ISO 4217 code used for currency style.
  currency?: string;
  maximumFractionDigits?: number;
  // Whether positive values display an explicit plus sign.
  showSign?: boolean;
  // Direction used to classify metric deltas.
  direction?: MetricDirection;
}

// Stored metric definition describing analytical intent.
export interface Metric {
  id: EntityId;
  datasetId: EntityId;
  name: string;
  aggregate: AggregateFunction;
  columnId?: EntityId;
  filters: EntityId[];
  format?: MetricFormat;
  // Optional transformation applied over the aggregate.
  modifier?: MetricModifier;
  createdBy: 'human' | 'agent' | 'system';
}
