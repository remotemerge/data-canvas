type Cell = string | number | boolean | null;

const toNumber = (value: Cell): number => (typeof value === 'number' ? value : Number(value ?? 0));

/**
 * Builds a box plot from the five-number summary DuckDB computed.
 *
 * ECharts' `boxplot` type expects `[min, Q1, median, Q3, max]` per box in that exact order, so the
 * rows are mapped positionally rather than through `encode`. The compiler emits the summary in the
 * same order, and `summaryOffset` says where it starts: a categorized box plot puts the category
 * first, an uncategorized one starts at zero.
 *
 * The outlier count rides along as tooltip data instead of as scatter points. Drawing the outliers
 * would need their values, and the query deliberately returns only how many there are.
 */
export const buildBoxplotSeries = (
  rows: readonly Cell[][],
  summaryOffset: number,
): { series: unknown[]; categories: string[] } => {
  const categories = rows.map((row, index) => (summaryOffset === 0 ? `all` : String(row[0] ?? index)));

  const boxes = rows.map((row) => [
    toNumber(row[summaryOffset] ?? null),
    toNumber(row[summaryOffset + 1] ?? null),
    toNumber(row[summaryOffset + 2] ?? null),
    toNumber(row[summaryOffset + 3] ?? null),
    toNumber(row[summaryOffset + 4] ?? null),
  ]);

  const outliers = rows.map((row) => toNumber(row[summaryOffset + 5] ?? null));

  return {
    categories,
    series: [
      {
        type: 'boxplot' as const,
        name: 'distribution',
        data: boxes.map((box, index) => ({ value: box, outlierCount: outliers[index] ?? 0 })),
      },
    ],
  };
};
