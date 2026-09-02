type Cell = string | number | boolean | null;

// A summary value that is null or unparseable leaves the box undrawable rather than collapsed at zero.
const toNumber = (value: Cell): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);

  return value === null || value === '' || !Number.isFinite(parsed) ? null : parsed;
};

/**
 * Maps DuckDB's five-number summary to an ECharts boxplot.
 *
 * `summaryOffset` is where `MIN, q1, median, q3, MAX` starts. An ungrouped box plot summarizes the
 * whole column and has a single unlabelled box; a grouped one carries its category ahead of the
 * summary, so the label comes from the row rather than being a constant.
 */
export const buildBoxplotSeries = (
  rows: readonly Cell[][],
  summaryOffset: number,
): { series: unknown[]; categories: string[] } => {
  const categories = rows.map((row, index) => (summaryOffset === 0 ? 'all' : String(row[summaryOffset - 1] ?? index)));

  const boxes = rows.map((row) => {
    const summary = [0, 1, 2, 3, 4].map((step) => toNumber(row[summaryOffset + step] ?? null));

    // ECharts draws nothing for a partial tuple, so an incomplete summary is dropped whole.
    return summary.every((value) => value !== null) ? summary : [];
  });

  return {
    categories,
    series: [
      {
        type: 'boxplot' as const,
        name: 'distribution',
        data: boxes,
      },
    ],
  };
};
