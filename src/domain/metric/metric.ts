import type { EntityId } from '@/shared/ids/entity-id.ts';

export type AggregateFunction = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'median';

export const AGGREGATE_FUNCTIONS: readonly AggregateFunction[] = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'median',
] as const;

export interface MetricFormat {
  style: 'plain' | 'decimal' | 'percent' | 'currency';
  /** ISO 4217 code; only meaningful when `style` is `currency`. */
  currency?: string;
  maximumFractionDigits?: number;
}

/**
 * Records permitted analytical intent rather than SQL. `filters` references stored `Filter`
 * entities by ID and never inlines predicates.
 */
export interface Metric {
  id: EntityId;
  datasetId: EntityId;
  name: string;
  aggregate: AggregateFunction;
  columnId?: EntityId;
  filters: EntityId[];
  format?: MetricFormat;
}
