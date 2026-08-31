import type { TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Transformations applied to an aggregate before display.
export type MetricModifier =
  | { kind: 'none' }
  | { kind: 'percentOfTotal' }
  | { kind: 'runningTotal'; orderBy: EntityId }
  | {
      kind: 'timeComparison';
      dateColumnId: EntityId;
      unit: TemporalUnit;
      // Positive periods to look back.
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

// Maximum supported look-back period.
export const MAX_TIME_COMPARISON_OFFSET = 104;

export const NO_MODIFIER: MetricModifier = { kind: 'none' };

// Whether an increase counts as an improvement.
export type MetricDirection = 'increaseIsGood' | 'increaseIsBad' | 'neutral';

export const METRIC_DIRECTIONS: readonly MetricDirection[] = ['increaseIsGood', 'increaseIsBad', 'neutral'] as const;
