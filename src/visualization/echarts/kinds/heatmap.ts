type Cell = string | number | boolean | null;

const toNumber = (value: Cell): number => (typeof value === 'number' ? value : Number(value ?? 0));

// Returns a category index, adding unseen values in order.
const positionOf = (list: string[], value: string): number => {
  const existing = list.indexOf(value);

  if (existing !== -1) return existing;

  list.push(value);

  return list.length - 1;
};

// Builds a heatmap from `[x, series, measure]` rows.
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
    // Use zero bounds when the result has no range.
    min: values.length === 0 ? 0 : Math.min(...values),
    max: values.length === 0 ? 0 : Math.max(...values),
    series: [{ type: 'heatmap' as const, name: 'value', data: cells }],
  };
};
