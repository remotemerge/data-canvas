export const buildBarSeries = (names: string[], x: string | undefined, stacked: boolean) =>
  names.map((name) => ({
    type: 'bar' as const,
    name,
    stack: stacked ? 'total' : undefined,
    encode: { x, y: name, tooltip: [x, name] },
  }));
