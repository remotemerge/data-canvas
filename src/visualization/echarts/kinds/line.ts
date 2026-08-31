// Hide symbols for dense lines but keep hover emphasis. Do not smooth measured values.
export const buildLineSeries = (names: string[], x: string | undefined, stacked: boolean) =>
  names.map((name) => ({
    type: 'line' as const,
    name,
    showSymbol: false,
    lineStyle: { width: 2 },
    stack: stacked ? 'total' : undefined,
    encode: { x, y: name, tooltip: [x, name] },
  }));
