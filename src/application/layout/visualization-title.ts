import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';

// Aggregate labels that add useful meaning to a generated title. `sum` remains implicit.
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
  measureName?: string;
  dimensionName?: string;
  aggregate?: AggregateFunction;
}

const describeMeasure = (
  measureName: string | undefined,
  aggregate: AggregateFunction | undefined,
): string | undefined => {
  if (measureName === undefined) {
    return undefined;
  }

  const prefix = aggregate === undefined ? undefined : AGGREGATE_LABEL[aggregate];

  return prefix === undefined ? measureName : `${prefix} ${measureName}`;
};

export const suggestVisualizationTitle = ({ kind, measureName, dimensionName, aggregate }: TitleInput): string => {
  const measure = describeMeasure(measureName, aggregate);

  // A histogram computes its own count, so the title names only its binned column.
  if (kind === 'histogram') {
    return dimensionName === undefined ? '' : `Distribution of ${dimensionName}`;
  }

  // A box plot describes one column's spread, optionally split by a category.
  if (kind === 'boxplot') {
    if (measureName === undefined) {
      return '';
    }

    return dimensionName === undefined ? `Spread of ${measureName}` : `Spread of ${measureName} by ${dimensionName}`;
  }

  if (measure === undefined) {
    return dimensionName === undefined ? '' : `Rows by ${dimensionName}`;
  }

  return dimensionName === undefined ? measure : `${measure} by ${dimensionName}`;
};
