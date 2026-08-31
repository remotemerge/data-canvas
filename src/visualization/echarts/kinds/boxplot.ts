type Cell = string | number | boolean | null;

const toNumber = (value: Cell): number => (typeof value === 'number' ? value : Number(value ?? 0));

// Maps DuckDB's five-number summary to an ECharts boxplot. Outlier count stays tooltip-only.
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
