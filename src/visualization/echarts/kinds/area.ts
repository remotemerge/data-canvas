// Use a light area fill so the line remains the value encoding.
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
