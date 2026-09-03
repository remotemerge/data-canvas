import { MAX_BIN_COUNT, MIN_BIN_COUNT } from '@/domain/analysis/bin-strategy.ts';
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
  // The second grouping dimension, which forms a heatmap's other axis.
  series: string;
  aggregate: AggregateFunction;
  binStrategy: BinStrategy;
  temporalDimension: boolean;
}

// An unselected channel is an empty string, which contributes nothing to the binding or the query.
const chosen = (columnId: string): boolean => columnId !== '';

// A KPI has no dimension, and a histogram bins its own dimension instead of taking a measure.
export const buildBinding = ({
  kind,
  x,
  y,
  series,
  binStrategy,
  temporalDimension,
}: ChannelSelection): VisualBinding => {
  if (kind === 'kpi') {
    return { y: chosen(y) ? [y] : [] };
  }

  if (kind === 'histogram') {
    return chosen(x) ? { x, binX: binStrategy } : {};
  }

  return {
    ...(chosen(x) ? { x } : {}),
    ...(chosen(y) ? { y: [y] } : {}),
    /*
     * Only a heatmap reads the series channel. Binding it on another kind would leave a stale second
     * dimension behind when someone switches kinds, which the validator then rejects.
     */
    ...(kind === 'heatmap' && chosen(series) ? { series } : {}),
    ...(temporalDimension ? { binX: DIMENSION_BIN } : {}),
  };
};

const histogramQuery = (datasetId: string, { x, binStrategy }: ChannelSelection) => ({
  datasetId,
  dimensions: [],
  ...(chosen(x) ? { binnedDimensions: [{ columnId: x, strategy: binStrategy }] } : {}),
  measures: [{ aggregate: 'count' as const }],
  filters: [],
});

const boxplotQuery = (datasetId: string, { x, y }: ChannelSelection) => ({
  datasetId,
  dimensions: [],
  measures: [],
  ...(chosen(y) ? { distribution: { columnId: y, ...(chosen(x) ? { categoryColumnId: x } : {}) } } : {}),
  filters: [],
});

// A scatter plot draws one mark per row, so both channels stay dimensions.
const scatterQuery = (datasetId: string, { x, y }: ChannelSelection) => ({
  datasetId,
  dimensions: [...(chosen(x) ? [x] : []), ...(chosen(y) ? [y] : [])],
  measures: [],
  filters: [],
});

/*
 * A heatmap grids two categorical dimensions, so both stay grouping columns and the measure fills
 * each cell. The renderer reads `[x, series, measure]` positionally, so the axis order matters.
 */
const heatmapQuery = (datasetId: string, { x, series, y, aggregate }: ChannelSelection) => ({
  datasetId,
  dimensions: [...(chosen(x) ? [x] : []), ...(chosen(series) ? [series] : [])],
  measures: chosen(y) ? [{ columnId: y, aggregate }] : [],
  filters: [],
});

const groupedQuery = (datasetId: string, { x, y, aggregate, temporalDimension }: ChannelSelection) => {
  const binned = chosen(x) && temporalDimension;

  return {
    datasetId,
    // Binned dimensions use the compiler's `binnedDimensions` shape.
    dimensions: chosen(x) && !temporalDimension ? [x] : [],
    ...(binned ? { binnedDimensions: [{ columnId: x, strategy: DIMENSION_BIN }] } : {}),
    measures: chosen(y) ? [{ columnId: y, aggregate }] : [],
    filters: [],
  };
};

/*
 * Distribution kinds use dedicated query shapes. Sharing this keeps an edited chart identical to an
 * equivalent new one, and both identical to what the matching WebMCP tool produces.
 */
export const buildQuery = (datasetId: string, selection: ChannelSelection) => {
  if (selection.kind === 'histogram') {
    return histogramQuery(datasetId, selection);
  }

  if (selection.kind === 'boxplot') {
    return boxplotQuery(datasetId, selection);
  }

  if (selection.kind === 'scatter') {
    return scatterQuery(datasetId, selection);
  }

  if (selection.kind === 'heatmap') {
    return heatmapQuery(datasetId, selection);
  }

  return groupedQuery(datasetId, selection);
};

/*
 * Clamps typed bucket counts to the bounds that cap result sizes. A number input still yields
 * arbitrary text, and an unparseable or zero entry falls back to the minimum rather than NaN.
 */
export const clampBinCount = (value: string): number =>
  Math.min(Math.max(Math.trunc(Number(value)) || MIN_BIN_COUNT, MIN_BIN_COUNT), MAX_BIN_COUNT);

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
