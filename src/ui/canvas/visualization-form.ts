import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { isTemporalType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import {
  VISUALIZATION_KINDS,
  type VisualBinding,
  type VisualizationKind,
} from '@/domain/visualization/visualization.ts';

export const CHART_KINDS = VISUALIZATION_KINDS.filter((kind) => kind !== 'table');

export const AGGREGATES: readonly AggregateFunction[] = ['sum', 'avg', 'min', 'max', 'median', 'stddev'] as const;

/*
 * Raw timestamps produce one group per instant, leaving a chart with too many marks, so temporal
 * dimensions bucket by day before querying. The sampling policy can widen the bucket later.
 */
export const DIMENSION_BIN: BinStrategy = { kind: 'temporal', unit: 'day' };

// Column offered by a chart form with its source dataset.
export interface ScopedColumn {
  column: Column;
  dataset: Dataset;
}

// Groups columns by dataset while preserving caller order, so joined columns keep their provenance.
export const groupByDataset = (columns: readonly ScopedColumn[]): { dataset: Dataset; columns: Column[] }[] => {
  const groups: { dataset: Dataset; columns: Column[] }[] = [];

  for (const scoped of columns) {
    const existing = groups.find((group) => group.dataset.id === scoped.dataset.id);

    if (existing === undefined) {
      groups.push({ dataset: scoped.dataset, columns: [scoped.column] });
    } else {
      existing.columns.push(scoped.column);
    }
  }

  return groups;
};

// The chart channels a form has collected, before they become a binding and a query.
export interface ChannelSelection {
  kind: VisualizationKind;
  x: string;
  y: string;
  aggregate: AggregateFunction;
  binStrategy: BinStrategy;
  temporalDimension: boolean;
}

// A KPI has no dimension, and a histogram bins its own dimension instead of taking a measure.
export const buildBinding = ({ kind, x, y, binStrategy, temporalDimension }: ChannelSelection): VisualBinding => {
  if (kind === 'kpi') {
    return { y: y === '' ? [] : [y] };
  }

  if (kind === 'histogram') {
    return x === '' ? {} : { x, binX: binStrategy };
  }

  return {
    ...(x === '' ? {} : { x }),
    ...(y === '' ? {} : { y: [y] }),
    ...(temporalDimension ? { binX: DIMENSION_BIN } : {}),
  };
};

/*
 * Distribution kinds use dedicated query shapes. Sharing this keeps an edited chart identical to an
 * equivalent new one, and both identical to what the matching WebMCP tool produces.
 */
export const buildQuery = (
  datasetId: string,
  { kind, x, y, aggregate, binStrategy, temporalDimension }: ChannelSelection,
) => {
  if (kind === 'histogram') {
    return {
      datasetId,
      dimensions: [],
      ...(x === '' ? {} : { binnedDimensions: [{ columnId: x, strategy: binStrategy }] }),
      measures: [{ aggregate: 'count' as const }],
      filters: [],
    };
  }

  if (kind === 'boxplot') {
    return {
      datasetId,
      dimensions: [],
      measures: [],
      ...(y === '' ? {} : { distribution: { columnId: y, ...(x === '' ? {} : { categoryColumnId: x }) } }),
      filters: [],
    };
  }

  // A scatter plot draws one mark per row, so both channels stay dimensions.
  if (kind === 'scatter') {
    return {
      datasetId,
      dimensions: [...(x === '' ? [] : [x]), ...(y === '' ? [] : [y])],
      measures: [],
      filters: [],
    };
  }

  return {
    datasetId,
    // Binned dimensions use the compiler's `binnedDimensions` shape.
    dimensions: x === '' || temporalDimension ? [] : [x],
    ...(x === '' || !temporalDimension ? {} : { binnedDimensions: [{ columnId: x, strategy: DIMENSION_BIN }] }),
    measures: y === '' ? [] : [{ columnId: y, aggregate }],
    filters: [],
  };
};

// Numeric and temporal columns can be binned; a histogram offers exactly these.
export const binnableColumns = (columns: readonly ScopedColumn[]): ScopedColumn[] =>
  columns.filter((scoped) => scoped.column.logicalType === 'number' || isTemporalType(scoped.column.logicalType));

export const numericColumns = (columns: readonly ScopedColumn[]): ScopedColumn[] =>
  columns.filter((scoped) => scoped.column.logicalType === 'number');

// Temporal bin columns group by month; numeric ones use the chosen bucket count.
export const resolveBinStrategy = (binnable: readonly ScopedColumn[], x: string, binCount: number): BinStrategy => {
  const column = binnable.find((scoped) => scoped.column.id === x)?.column;

  return column !== undefined && column.logicalType !== 'number'
    ? { kind: 'temporal', unit: 'month' }
    : { kind: 'equalWidth', binCount };
};
