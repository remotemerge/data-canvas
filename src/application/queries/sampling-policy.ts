export const MAX_CHART_POINTS = 5_000;

// Minimum and maximum point targets used for temporal chart legibility.
const MIN_READABLE_POINTS = 60;
const MAX_READABLE_POINTS = 300;

// Horizontal pixels allocated to each visible mark.
const PIXELS_PER_POINT = 5;

// Returns a width-aware point target, clamped to the policy bounds.
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
