/*
 * Symbols are hidden but not disabled: `showSymbol: false` still renders one on hover and on the
 * emphasised point, so a dense series reads as a line rather than a string of beads while a single
 * point remains hoverable.
 *
 * Deliberately unsmoothed. A spline through discrete measurements invents values between them and
 * overshoots real extremes, which would make the chart assert movement the data does not record.
 */
export const buildLineSeries = (names: string[], x: string | undefined, stacked: boolean) =>
  names.map((name) => ({
    type: 'line' as const,
    name,
    showSymbol: false,
    lineStyle: { width: 2 },
    stack: stacked ? 'total' : undefined,
    encode: { x, y: name, tooltip: [x, name] },
  }));
