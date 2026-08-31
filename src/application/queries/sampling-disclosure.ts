import type { SamplingDisclosure } from '@/application/queries/adaptive-sampling.ts';
import { temporalUnitLabel } from '@/application/queries/adaptive-sampling.ts';
import type { CellValue } from '@/data/duckdb/arrow-conversion.ts';

// Converts a sampling decision into the badge label and explanation shown to users.

export interface DisclosureText {
  // Short badge label.
  label: string;
  // Full sentence for the tooltip, naming the strategy and its effect on the numbers.
  explanation: string;
}

const percent = (rate: number): string => {
  const value = rate * 100;

  return value < 0.01 ? '<0.01%' : `${value < 1 ? value.toFixed(2) : value.toFixed(1)}%`;
};

export const describeSampling = (disclosure: SamplingDisclosure): DisclosureText => {
  const { strategy } = disclosure;

  switch (strategy.kind) {
    case 'exact':
      return { label: 'Exact', explanation: 'Every matching row is included in this result.' };

    case 'topN':
      return {
        label: `Top ${strategy.retained.toLocaleString()} + Other`,
        explanation: `This chart shows the ${strategy.retained.toLocaleString()} largest categories individually; every remaining category is aggregated into a single "Other" bucket, so summable measures still add up to the full total. Every row was read, so each value shown is exact. Measures that cannot be summed across groups — averages, medians, and distinct counts — are left blank in the "Other" row rather than estimated.`,
      };

    case 'temporalWiden':
      return {
        label: `${temporalUnitLabel[strategy.to]} buckets`,
        explanation: `${temporalUnitLabel[strategy.from]} buckets would exceed the plotted-point budget, so this chart is grouped by ${strategy.to} instead. Every row was read, so each bucket's value is exact — but the axis shows ${strategy.to}s, not ${strategy.from}s.`,
      };

    case 'reservoir':
      return {
        label: `${percent(strategy.rate)} sample`,
        explanation: `This chart plots a uniform random sample of ${percent(strategy.rate)} of the matching rows. The overall shape is representative, but individual points are a subset and counts are not totals.`,
      };

    case 'tablesample':
      return {
        label: `Approximate (${percent(strategy.rate)})`,
        explanation: `This value is estimated from a ${percent(strategy.rate)} sample of the rows and scaled up. Treat it as approximate, not as a measured total.`,
      };
  }
};

// Appends an `Other` row by subtracting retained sums from the whole-population totals.
export const OTHER_BUCKET_LABEL = 'Other';

// Aggregates that can produce an exact `Other` row by subtraction.
const ADDITIVE_AGGREGATES: readonly string[] = ['count', 'sum'] as const;

export const isAdditiveAggregate = (aggregate: string): boolean => ADDITIVE_AGGREGATES.includes(aggregate);

export const foldOtherBucket = (
  rows: readonly CellValue[][],
  measureStartIndex: number,
  populationTotals: readonly CellValue[],
  additiveByMeasure: readonly boolean[],
): CellValue[][] => {
  const kept = rows.map((row) => [...row]);
  const width = rows[0]?.length ?? measureStartIndex + populationTotals.length;
  const other: CellValue[] = Array.from({ length: width }, (_unused, index) =>
    index === 0 ? OTHER_BUCKET_LABEL : null,
  );

  for (let index = measureStartIndex; index < width; index += 1) {
    const measureIndex = index - measureStartIndex;
    const total = populationTotals[measureIndex];

    if (additiveByMeasure[measureIndex] !== true || typeof total !== 'number') continue;

    let retainedSum = 0;

    for (const row of rows) {
      const value = row[index];

      if (typeof value === 'number') retainedSum += value;
    }

    // Clamp floating-point residue so `Other` cannot become a negative bar.
    other[index] = Math.max(total - retainedSum, 0);
  }

  return [...kept, other];
};
