import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * How a continuous column is divided into discrete buckets.
 *
 * Binning is a domain concept rather than a chart setting. A histogram must aggregate in DuckDB, so
 * the strategy has to survive into the query compiler; if it lived in the renderer, ECharts would
 * receive raw values and bin them on the main thread, which the point budget forbids.
 */
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

/*
 * Bucket-count bounds.
 *
 * These cap the rows a histogram can return, so they are a result-size limit rather than a taste
 * judgement. Quantiles stop lower because `ntile` with a large N over a small dataset produces
 * mostly empty buckets that read as noise.
 */
export const MIN_BIN_COUNT = 2;
export const MAX_BIN_COUNT = 100;
export const MIN_QUANTILE_COUNT = 2;
export const MAX_QUANTILE_COUNT = 20;
export const MAX_EXPLICIT_BREAKS = 100;

/**
 * The numeric range a strategy needs before it can be compiled.
 *
 * `equalWidth` and `equalWidthOf` cannot produce boundaries without knowing where the data starts
 * and ends, so the compiler takes the range as input rather than reading it itself. That keeps the
 * compiler synchronous and pure, and leaves the caller free to cache the range.
 */
export interface ColumnRange {
  min: number;
  max: number;
}

/** True when compiling the strategy requires a `ColumnRange`. */
export const needsColumnRange = (strategy: BinStrategy): boolean =>
  strategy.kind === 'equalWidth' || strategy.kind === 'equalWidthOf';

/**
 * A binned column reference, used wherever a plain dimension would be.
 *
 * Carrying the column ID alongside the strategy lets a query bind one column raw and another binned
 * without the two channels needing different shapes.
 */
export interface BinnedDimension {
  columnId: EntityId;
  strategy: BinStrategy;
}
