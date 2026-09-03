import { useMemo } from 'react';
import { reachableDatasets } from '@/application/relationships/related-datasets.ts';
import { validateVisualization } from '@/application/validation/validate-visualization.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { isTemporalType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualBinding, VisualizationKind } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import {
  binnableColumns,
  buildBinding,
  type ChannelSelection,
  numericColumns,
  resolveBinStrategy,
  type ScopedColumn,
} from '@/ui/canvas/visualization-form.ts';

// The two grouping channels a chart form can bind. Only a heatmap uses both.
type ChartAxis = 'x' | 'series';

// Everything the builder and the editor derive from the same channel choices.
export interface ChartChannels {
  scopedColumns: ScopedColumn[];
  measureColumns: ScopedColumn[];
  binnable: ScopedColumn[];
  dimensionColumns: ScopedColumn[];
  // Columns offerable as a heatmap's second axis, excluding the one already on the first.
  seriesColumns: ScopedColumn[];
  temporalBin: boolean;
  selection: ChannelSelection;
  binding: VisualBinding;
  validation: ReturnType<typeof validateVisualization> | null;
}

/**
 * Derives the column choices and validation a chart form offers for the current channel selection.
 *
 * The builder and the editor must agree on which columns are offerable and what binding a selection
 * produces, otherwise a chart created by one could not be reproduced by the other, and neither would
 * match the equivalent WebMCP call.
 */
export const useChartChannels = (
  workspace: Workspace,
  dataset: Dataset | undefined,
  channels: {
    kind: VisualizationKind;
    x: string;
    y: string;
    series: string;
    aggregate: AggregateFunction;
    binCount: number;
  },
): ChartChannels => {
  const { kind, x, y, series, aggregate, binCount } = channels;

  // Offer columns from datasets reachable from the anchor.
  const related = useMemo(
    () => (dataset === undefined ? [] : reachableDatasets(workspace, dataset.id)),
    [workspace, dataset],
  );

  const scopedColumns = useMemo<ScopedColumn[]>(
    () =>
      dataset === undefined
        ? []
        : [dataset, ...related].flatMap((source) => source.columns.map((column) => ({ column, dataset: source }))),
    [dataset, related],
  );

  const measureColumns = numericColumns(scopedColumns);
  const binnable = binnableColumns(scopedColumns);

  const histogramColumn = binnable.find((scoped) => scoped.column.id === x)?.column;
  const temporalBin = histogramColumn !== undefined && histogramColumn.logicalType !== 'number';
  const binStrategy = resolveBinStrategy(binnable, x, binCount);

  // A form with no measure chosen yet still needs one to validate candidates against.
  const validationMeasure = y === '' ? measureColumns[0]?.column.id : y;

  /*
   * A heatmap needs both axes bound before its binding validates, so a candidate for one axis is
   * tested with the opposite axis filled in. While that axis is still unset any other column stands
   * in, because the check asks whether this column could work, not whether the form is complete yet.
   * Without the stand-in every candidate fails and the picker offers nothing, which left the kind
   * impossible to build by hand even though the equivalent WebMCP call succeeded.
   */
  const oppositeAxis = (columnId: EntityId, channel: ChartAxis): EntityId | undefined => {
    const bound = channel === 'x' ? series : x;

    return bound === '' ? scopedColumns.find((scoped) => scoped.column.id !== columnId)?.column.id : bound;
  };

  // The binding a picker tests a candidate column with, which mirrors what the form would produce.
  const candidateBinding = (columnId: EntityId, channel: ChartAxis): VisualBinding => {
    const measure = validationMeasure === undefined ? {} : { y: [validationMeasure] };
    const opposite = kind === 'heatmap' ? oppositeAxis(columnId, channel) : undefined;

    if (opposite === undefined) {
      return { x: columnId, ...measure };
    }

    return channel === 'x'
      ? { x: columnId, series: opposite, ...measure }
      : { x: opposite, series: columnId, ...measure };
  };

  /*
   * Validating each candidate against a representative measure keeps columns the kind cannot plot
   * out of the picker, rather than letting a person choose one and then blocking the submit button.
   */
  const offerable = (columnId: EntityId, channel: ChartAxis): boolean =>
    dataset !== undefined &&
    kind !== 'kpi' &&
    validationMeasure !== undefined &&
    validateVisualization(dataset, kind, candidateBinding(columnId, channel), related).ok;

  const dimensionColumns = scopedColumns.filter((scoped) => offerable(scoped.column.id, 'x'));

  // The two heatmap axes must differ, so the column already on x is not offered again.
  const seriesColumns =
    kind === 'heatmap'
      ? scopedColumns.filter((scoped) => scoped.column.id !== x && offerable(scoped.column.id, 'series'))
      : [];

  const xDimension = dimensionColumns.find((scoped) => scoped.column.id === x)?.column;
  /*
   * A heatmap groups its axes as categories rather than binning them into a time series, so the
   * temporal day bucket that trend charts apply would turn one axis into thousands of columns.
   */
  const temporalDimension = kind !== 'heatmap' && xDimension !== undefined && isTemporalType(xDimension.logicalType);

  const selection: ChannelSelection = { kind, x, y, series, aggregate, binStrategy, temporalDimension };
  const binding = buildBinding(selection);

  return {
    scopedColumns,
    measureColumns,
    binnable,
    dimensionColumns,
    seriesColumns,
    temporalBin,
    selection,
    binding,
    validation: dataset === undefined ? null : validateVisualization(dataset, kind, binding, related),
  };
};
