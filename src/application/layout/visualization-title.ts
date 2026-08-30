import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';

/**
 * Aggregates whose name belongs in the title.
 *
 * `sum` is the default and reads as the plain quantity — "Sales by Region" already means total
 * sales, so naming it adds nothing. The rest genuinely change what the number is, and a chart of
 * averages titled as though it showed totals would misreport the data.
 */
const AGGREGATE_LABEL: Partial<Record<AggregateFunction, string>> = {
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  median: 'Median',
  stddev: 'Spread of',
  count: 'Count of',
  count_distinct: 'Distinct',
};

interface TitleInput {
  kind: VisualizationKind;
  /** Display name of the measure column, absent for kinds that have no measure. */
  measureName?: string;
  /** Display name of the dimension or binned column, absent when the chart has no dimension. */
  dimensionName?: string;
  aggregate?: AggregateFunction;
}

/**
 * Proposes a title describing what the chart shows.
 *
 * Analytical phrasing rather than the binding's mechanics: "Sales by Order Date", not `sum` over
 * `a`. It is a starting point the user edits, so it favours reading naturally over being exhaustive
 * — nothing here is authoritative, and an empty result simply means the caller has too little bound
 * to describe yet.
 */
export const suggestVisualizationTitle = ({ kind, measureName, dimensionName, aggregate }: TitleInput): string => {
  const prefix = aggregate === undefined ? undefined : AGGREGATE_LABEL[aggregate];
  const measure =
    measureName === undefined ? undefined : prefix === undefined ? measureName : `${prefix} ${measureName}`;

  // A histogram's y is a count it computes itself, so its subject is the binned column alone.
  if (kind === 'histogram') return dimensionName === undefined ? '' : `Distribution of ${dimensionName}`;

  // A box plot summarises one column's spread, optionally split by a category.
  if (kind === 'boxplot') {
    if (measureName === undefined) return '';

    return dimensionName === undefined ? `Spread of ${measureName}` : `Spread of ${measureName} by ${dimensionName}`;
  }

  if (measure === undefined) return dimensionName === undefined ? '' : `Rows by ${dimensionName}`;

  return dimensionName === undefined ? measure : `${measure} by ${dimensionName}`;
};
