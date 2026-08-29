type Cell = string | number | boolean | null;

const toNumber = (value: Cell): number => (typeof value === 'number' ? value : Number(value ?? 0));

/** Returns the value's position, appending it first if this is the first time it appears. */
const positionOf = (list: string[], value: string): number => {
  const existing = list.indexOf(value);

  if (existing !== -1) return existing;

  list.push(value);

  return list.length - 1;
};

/**
 * Builds a heatmap from rows of `[x, series, measure]`.
 *
 * ECharts' heatmap wants `[xIndex, yIndex, value]` against two category axes, so the two dimensions
 * are collected into ordered category lists and the cells reference them by position. Passing the
 * raw values instead would leave ECharts to derive the axes, and its ordering would not match the
 * one the query produced.
 *
 * `visualMap` bounds come from the data rather than from a fixed scale, since a measure's range is
 * unknown until the query runs.
 */
export const buildHeatmapSeries = (
  rows: readonly Cell[][],
): { series: unknown[]; xCategories: string[]; yCategories: string[]; min: number; max: number } => {
  const xCategories: string[] = [];
  const yCategories: string[] = [];

  const cells = rows.map((row) => {
    const x = positionOf(xCategories, String(row[0] ?? ''));
    const y = positionOf(yCategories, String(row[1] ?? ''));

    return [x, y, toNumber(row[2] ?? null)];
  });

  const values = cells.map((cell) => cell[2] as number);

  return {
    xCategories,
    yCategories,
    // An empty result has no range. Zero for both bounds keeps `visualMap` valid rather than NaN.
    min: values.length === 0 ? 0 : Math.min(...values),
    max: values.length === 0 ? 0 : Math.max(...values),
    series: [{ type: 'heatmap' as const, name: 'value', data: cells }],
  };
};
