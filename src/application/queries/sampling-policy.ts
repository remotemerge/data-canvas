export const MAX_CHART_POINTS = 5_000;

/**
 * Bounds on the readable point target.
 *
 * The floor keeps a narrow panel from collapsing a series into a handful of buckets that hide its
 * shape; the ceiling is where marks start landing closer together than a few pixels and the line
 * reads as a band of noise rather than a trend.
 */
const MIN_READABLE_POINTS = 60;
const MAX_READABLE_POINTS = 300;

/** Horizontal pixels each mark needs before neighbouring marks visually merge. */
const PIXELS_PER_POINT = 5;

/**
 * How many points a plot of a given width can actually show.
 *
 * Distinct from `MAX_CHART_POINTS`, which is a performance ceiling: 5,000 marks render fine and are
 * still unreadable in 900 pixels. This is the legibility target, so a year of daily values is
 * bucketed to weeks or months instead of being drawn as hundreds of overlapping spikes. It only ever
 * lowers the point count — the hard budget still applies on top of it.
 */
export const readableChartPoints = (plotWidth: number): number =>
  Math.min(Math.max(Math.floor(plotWidth / PIXELS_PER_POINT), MIN_READABLE_POINTS), MAX_READABLE_POINTS);

export interface SamplingDecision {
  limit: number;
  sampled: boolean;
}

export const chartSamplingDecision = (requestedLimit?: number): SamplingDecision => ({
  limit: Math.min(requestedLimit ?? MAX_CHART_POINTS + 1, MAX_CHART_POINTS + 1),
  sampled: requestedLimit !== undefined && requestedLimit > MAX_CHART_POINTS,
});

export const boundChartRows = <T>(rows: readonly T[]): { rows: readonly T[]; sampled: boolean } => ({
  rows: rows.slice(0, MAX_CHART_POINTS),
  sampled: rows.length > MAX_CHART_POINTS,
});
