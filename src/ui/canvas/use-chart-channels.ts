import { useMemo } from 'react';
import { reachableDatasets } from '@/application/relationships/related-datasets.ts';
import { validateVisualization } from '@/application/validation/validate-visualization.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { isTemporalType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualBinding, VisualizationKind } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import {
  binnableColumns,
  buildBinding,
  type ChannelSelection,
  numericColumns,
  resolveBinStrategy,
  type ScopedColumn,
} from '@/ui/canvas/visualization-form.ts';

// Everything the builder and the editor derive from the same channel choices.
export interface ChartChannels {
  scopedColumns: ScopedColumn[];
  measureColumns: ScopedColumn[];
  binnable: ScopedColumn[];
  dimensionColumns: ScopedColumn[];
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
  channels: { kind: VisualizationKind; x: string; y: string; aggregate: AggregateFunction; binCount: number },
): ChartChannels => {
  const { kind, x, y, aggregate, binCount } = channels;

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

  // Validating each candidate against a representative measure keeps unusable columns out of the picker.
  const validationMeasure = y === '' ? measureColumns[0]?.column.id : y;
  const dimensionColumns = scopedColumns.filter((scoped) => {
    if (dataset === undefined || kind === 'kpi' || validationMeasure === undefined) {
      return false;
    }

    return validateVisualization(dataset, kind, { x: scoped.column.id, y: [validationMeasure] }, related).ok;
  });

  const seriesDimension = dimensionColumns.find((scoped) => scoped.column.id === x)?.column;
  const temporalDimension = seriesDimension !== undefined && isTemporalType(seriesDimension.logicalType);

  const selection: ChannelSelection = { kind, x, y, aggregate, binStrategy, temporalDimension };
  const binding = buildBinding(selection);

  return {
    scopedColumns,
    measureColumns,
    binnable,
    dimensionColumns,
    temporalBin,
    selection,
    binding,
    validation: dataset === undefined ? null : validateVisualization(dataset, kind, binding, related),
  };
};
