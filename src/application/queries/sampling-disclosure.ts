import type { SamplingDisclosure } from '@/application/queries/adaptive-sampling.ts';
import { temporalUnitLabel } from '@/application/queries/adaptive-sampling.ts';
import type { CellValue } from '@/data/duckdb/arrow-conversion.ts';

/**
 * Turns a sampling decision into the text the UI shows and the sentence that explains it.
 *
 * Kept out of the React component so the same wording reaches a badge, a tooltip, and any future
 * agent-facing summary. The explanation states what was actually done, not that "sampling occurred":
 * a user who cannot tell which number is approximate has not been informed.
 */

export interface DisclosureText {
  /** Short badge label. */
  label: string;
  /** Full sentence for the tooltip, naming the strategy and its effect on the numbers. */
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

/**
 * Appends an aggregated "Other" row to the retained groups.
 *
 * The bucket is the whole-population total minus the sum of the retained rows. Deriving it by
 * subtraction rather than by reading the remaining groups is what keeps the operation bounded: the
 * unretained groups may number in the millions, and reading them is exactly the work sampling exists
 * to avoid.
 *
 * A chart whose bars no longer add up to the total the user knows is worse than a slow chart, so the
 * bucket is never dropped — but a measure that cannot be summed meaningfully reports `null` rather
 * than a fabricated figure.
 *
 * `measureStartIndex` is where the measure columns begin. Everything before it is a dimension and is
 * replaced by the bucket's label.
 */
export const OTHER_BUCKET_LABEL = 'Other';

/**
 * Aggregates whose per-group values sum to the whole-population value.
 *
 * Only these can be reconciled by subtraction. An `avg`, `min`, `max`, or `median` over the whole
 * population is not the sum of its per-group results, and `count_distinct` double-counts any value
 * appearing in more than one group — folding either would state a number that is simply wrong.
 */
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

    // Clamped at zero. Floating-point drift on a large sum can otherwise produce a faintly negative
    // remainder, which would render as a bar pointing the wrong way.
    other[index] = Math.max(total - retainedSum, 0);
  }

  return [...kept, other];
};
