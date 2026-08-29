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
  /** ISO 4217 code; only meaningful when `style` is `currency`. */
  currency?: string;
  maximumFractionDigits?: number;
  /** Renders an explicit `+` on positive values, which a comparison metric needs and a total does not. */
  showSign?: boolean;
  /**
   * Which direction counts as an improvement, used to colour a delta.
   *
   * Recorded rather than inferred: a rising `sum` is good for revenue and bad for refunds, and the
   * definitions are otherwise identical.
   */
  direction?: MetricDirection;
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
  /**
   * Transformation applied over the aggregate. Absent means a plain aggregate, so existing metrics
   * keep their meaning without a rewrite.
   */
  modifier?: MetricModifier;
  createdBy: 'human' | 'agent' | 'system';
}
