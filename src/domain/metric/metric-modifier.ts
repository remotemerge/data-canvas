import type { TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * How a metric's aggregate is transformed before it is displayed.
 *
 * Each modifier compiles to a DuckDB window function over the aggregate, so the arithmetic runs in
 * the engine and the result stays one bounded row set. Computing these in JavaScript would need the
 * ungrouped rows in memory, which is the pattern the performance rules forbid.
 */
export type MetricModifier =
  | { kind: 'none' }
  | { kind: 'percentOfTotal' }
  | { kind: 'runningTotal'; orderBy: EntityId }
  | {
      kind: 'timeComparison';
      dateColumnId: EntityId;
      unit: TemporalUnit;
      /** Periods to look back. Positive; 1 compares against the immediately preceding period. */
      offset: number;
      as: TimeComparisonOutput;
    };

export type TimeComparisonOutput = 'absolute' | 'difference' | 'percentChange';

export const TIME_COMPARISON_OUTPUTS: readonly TimeComparisonOutput[] = [
  'absolute',
  'difference',
  'percentChange',
] as const;

export const METRIC_MODIFIER_KINDS: readonly MetricModifier['kind'][] = [
  'none',
  'percentOfTotal',
  'runningTotal',
  'timeComparison',
] as const;

/** Upper bound on the look-back. Beyond this the date spine grows past a useful chart. */
export const MAX_TIME_COMPARISON_OFFSET = 104;

export const NO_MODIFIER: MetricModifier = { kind: 'none' };

/**
 * Whether an increase in this metric is good news.
 *
 * The application cannot infer this. Revenue rising is good and churn rising is not, and both are
 * `sum` over a numeric column, so direction has to be recorded rather than derived.
 */
export type MetricDirection = 'increaseIsGood' | 'increaseIsBad' | 'neutral';

export const METRIC_DIRECTIONS: readonly MetricDirection[] = ['increaseIsGood', 'increaseIsBad', 'neutral'] as const;
