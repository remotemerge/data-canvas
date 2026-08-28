export const buildScatterSeries = (names: string[], x: string | undefined) =>
  names.map((name) => ({ type: 'scatter' as const, name, encode: { x, y: name, tooltip: [x, name] } }));
