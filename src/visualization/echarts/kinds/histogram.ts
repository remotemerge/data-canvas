// Renders pre-binned rows as a touching bar series.
export const buildHistogramSeries = (measure: string | undefined, x: string | undefined) => [
  {
    type: 'bar' as const,
    name: measure ?? 'count',
    barCategoryGap: 0,
    encode: { x, y: measure, tooltip: [x, measure] },
  },
];
