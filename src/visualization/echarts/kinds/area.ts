/**
 * The fill is a weight cue, not a second encoding.
 *
 * At full opacity the area dominates the line whose position carries the actual value, and stacked
 * bands become indistinguishable from one another. A faint wash keeps the series legible where they
 * overlap. Unsmoothed for the same reason as `line`: a spline would assert values between the
 * measured points.
 */
const AREA_FILL_OPACITY = 0.08;

export const buildAreaSeries = (names: string[], x: string | undefined, stacked: boolean) =>
  names.map((name) => ({
    type: 'line' as const,
    name,
    showSymbol: false,
    lineStyle: { width: 2 },
    areaStyle: { opacity: AREA_FILL_OPACITY },
    stack: stacked ? 'total' : undefined,
    encode: { x, y: name, tooltip: [x, name] },
  }));
