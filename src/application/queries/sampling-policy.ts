export const MAX_CHART_POINTS = 5_000;

/*
 * Slices a donut can carry before it stops being readable. Angular segments become hard to compare
 * and their labels overlap long before a bar chart runs out of horizontal room, so this budget is far
 * below `MAX_CHART_POINTS`. Groups beyond it fold into the `Other` bucket the top-N strategy already
 * produces, which keeps the total correct and discloses the reduction.
 */
export const MAX_DONUT_SLICES = 12;

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
