export const MAX_CHART_POINTS = 5_000;

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
