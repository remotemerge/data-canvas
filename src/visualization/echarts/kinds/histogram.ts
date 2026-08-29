/**
 * A histogram is a bar series over buckets DuckDB already computed.
 *
 * `barCategoryGap` at zero is what visually separates a histogram from a bar chart: adjacent bins
 * touch, because the axis is continuous rather than categorical.
 *
 * ECharts never bins here. The rows arrive one per bucket, so the renderer only draws them.
 */
export const buildHistogramSeries = (measure: string | undefined, x: string | undefined) => [
  {
    type: 'bar' as const,
    name: measure ?? 'count',
    barCategoryGap: 0,
    encode: { x, y: measure, tooltip: [x, measure] },
  },
];
