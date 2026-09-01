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

/**
 * Upper bound on the groups a strategy can produce, independent of the data.
 *
 * A binned dimension collapses the column's distinct values into buckets, so its group count follows
 * from the strategy rather than the column's cardinality. Temporal bucket counts depend on the range
 * of the underlying dates, so they have no static bound and return `undefined`.
 */
export const maxBinCardinality = (strategy: BinStrategy): number | undefined => {
  switch (strategy.kind) {
    case 'equalWidth':
      return strategy.binCount;

    // The compiler rejects a width that produces more than `MAX_BIN_COUNT` buckets over the column.
    case 'equalWidthOf':
      return MAX_BIN_COUNT;

    case 'quantile':
      return strategy.quantiles;

    // Each break opens a bucket, plus the trailing `ELSE` bucket above the last break.
    case 'explicit':
      return strategy.breaks.length + 1;

    case 'temporal':
      return undefined;
  }
};

// Column reference paired with its binning strategy.
export interface BinnedDimension {
  columnId: EntityId;
  strategy: BinStrategy;
}
