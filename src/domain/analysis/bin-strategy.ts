import type { EntityId } from '@/shared/ids/entity-id.ts';

// Strategies for dividing continuous columns into buckets.
export type BinStrategy =
  | { kind: 'equalWidth'; binCount: number }
  | { kind: 'equalWidthOf'; width: number }
  | { kind: 'quantile'; quantiles: number }
  | { kind: 'explicit'; breaks: number[] }
  | { kind: 'temporal'; unit: TemporalUnit };

export type TemporalUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const TEMPORAL_UNITS: readonly TemporalUnit[] = ['day', 'week', 'month', 'quarter', 'year'] as const;

export const BIN_STRATEGY_KINDS: readonly BinStrategy['kind'][] = [
  'equalWidth',
  'equalWidthOf',
  'quantile',
  'explicit',
  'temporal',
] as const;

// Bucket-count bounds that cap result sizes.
export const MIN_BIN_COUNT = 2;
export const MAX_BIN_COUNT = 100;
export const MIN_QUANTILE_COUNT = 2;
export const MAX_QUANTILE_COUNT = 20;
export const MAX_EXPLICIT_BREAKS = 100;

// Numeric range required by strategies that compute boundaries.
export interface ColumnRange {
  min: number;
  max: number;
}

// Whether compilation requires a `ColumnRange`.
export const needsColumnRange = (strategy: BinStrategy): boolean =>
  strategy.kind === 'equalWidth' || strategy.kind === 'equalWidthOf';

// Column reference paired with its binning strategy.
export interface BinnedDimension {
  columnId: EntityId;
  strategy: BinStrategy;
}
