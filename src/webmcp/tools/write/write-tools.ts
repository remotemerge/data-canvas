import type {
  AddAnnotationInput,
  CreateVisualizationInput,
  UpdateVisualizationInput,
} from '@/application/actions/action-types.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import type { FilterOperator } from '@/domain/filter/filter.ts';
import type { VisualizationKind, VisualBinding } from '@/domain/visualization/visualization.ts';
import type { SelectionLinkMode } from '@/domain/visualization/selection-link-mode.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { ToolDependencies, DataCanvasTool } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { createCreateDerivedColumnTool } from '@/webmcp/tools/write/create-derived-column.ts';
import { createClearSelectionTool } from '@/webmcp/tools/write/clear-selection.ts';
import { createHistoryTools } from '@/webmcp/tools/write/history-tools.ts';
import { createCreateRelationshipTool } from '@/webmcp/tools/write/create-relationship.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

const dispatch = async (
  deps: ToolDependencies,
  action: Parameters<ToolDependencies['dispatcher']['execute']>[0],
  expectedRevision: number | undefined,
  extra: (changedIds: string[]) => Record<string, unknown> = () => ({}),
  signal?: AbortSignal,
): Promise<string> => {
  const result = await deps.dispatcher.execute(action, {
    actor: 'agent',
    expectedRevision,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!result.ok) {
    return failure(result.error);
  }
  return success({
    revision: result.value.revision,
    summary: result.value.summary,
    ...extra(result.value.changedEntityIds),
  });
};

const bindingFrom = (input: ReturnType<typeof asInput>, fallback?: VisualBinding): VisualBinding => ({
  ...fallback,
  ...(input.xColumnId === undefined ? {} : { x: input.xColumnId as string }),
  ...(input.yColumnIds === undefined ? {} : { y: input.yColumnIds as string[] }),
  ...(input.groupByColumnId === undefined ? {} : { series: input.groupByColumnId as string }),
  ...(input.binX === undefined ? {} : { binX: input.binX as BinStrategy }),
  ...(input.binSeries === undefined ? {} : { binSeries: input.binSeries as BinStrategy }),
});

// Builds the analysis query for a visualization binding.
const queryFrom = (
  datasetId: string,
  input: ReturnType<typeof asInput>,
  binding: VisualBinding,
  kind: VisualizationKind,
): AnalysisQuery => {
  if (kind === 'histogram') {
    return {
      datasetId,
      dimensions: [],
      ...(binding.x === undefined || binding.binX === undefined
        ? {}
        : { binnedDimensions: [{ columnId: binding.x, strategy: binding.binX }] }),
      measures: [{ aggregate: 'count' }],
      filters: [],
    };
  }

  /*
   * A scatter plot shows one mark per row, so both channels are dimensions. Aggregating y would
   * collapse every row sharing an x value into a single point.
   */
  if (kind === 'scatter') {
    return {
      datasetId,
      dimensions: [
        ...(binding.x === undefined ? [] : [binding.x]),
        ...(binding.y ?? []),
        ...(binding.series === undefined ? [] : [binding.series]),
      ],
      measures: [],
      filters: [],
    };
  }

  if (kind === 'boxplot') {
    const [measureId] = binding.y ?? [];

    return {
      datasetId,
      dimensions: [],
      measures: [],
      ...(measureId === undefined
        ? {}
        : {
            distribution: {
              columnId: measureId,
              ...(binding.x === undefined ? {} : { categoryColumnId: binding.x }),
            },
          }),
      filters: [],
    };
  }

  return groupedQuery(datasetId, input, binding);
};

// Builds the grouped query shared by every kind that aggregates measures over dimensions.
const groupedQuery = (datasetId: string, input: ReturnType<typeof asInput>, binding: VisualBinding): AnalysisQuery => {
  const binned = [
    ...(binding.x === undefined || binding.binX === undefined ? [] : [{ columnId: binding.x, strategy: binding.binX }]),
    ...(binding.series === undefined || binding.binSeries === undefined
      ? []
      : [{ columnId: binding.series, strategy: binding.binSeries }]),
  ];

  // Move binned channels to binnedDimensions.
  const binnedIds = new Set(binned.map((entry) => entry.columnId));

  return {
    datasetId,
    dimensions: [...new Set([binding.x, binding.series].filter((id): id is string => id !== undefined))].filter(
      (id) => !binnedIds.has(id),
    ),
    ...(binned.length === 0 ? {} : { binnedDimensions: binned }),
    measures:
      binding.y === undefined || binding.y.length === 0
        ? [{ aggregate: 'count' }]
        : binding.y.map((columnId) => ({
            columnId,
            aggregate: (input.aggregate as AggregateFunction | undefined) ?? 'sum',
          })),
    filters: [],
  };
};

export const createWriteTools = (deps: ToolDependencies): DataCanvasTool[] => [
  createCreateRelationshipTool(deps),
  createCreateDerivedColumnTool(deps),
  createClearSelectionTool(deps),
  ...createHistoryTools(deps),
  {
    name: 'create_visualization',
    title: 'Create visualization',
    description:
      'Add a chart, KPI, table, histogram, box plot, or heatmap to the shared workspace, where it becomes visible immediately. Specify columns and an aggregate. The application builds the query and renderer configuration, then computes bins and distribution statistics in the engine. Returns visualizationId for update_visualization, add_annotation, or remove_visualization. Use analyze_data first when you need to inspect the numbers. Use update_visualization when refining an existing chart.',
    schema: toolSchemas.create_visualization,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw, signal) => {
      const input = asInput(raw);
      const datasetId = input.datasetId as string;
      const binding = bindingFrom(input);
      const kind = input.kind as VisualizationKind;
      const payload: CreateVisualizationInput = {
        datasetId,
        title: input.title as string,
        kind,
        binding,
        query: queryFrom(datasetId, input, binding, kind),
      };
      return dispatch(
        deps,
        { type: 'visualization.create', payload },
        input.expectedRevision as number,
        ([visualizationId]) => ({ visualizationId }),
        signal,
      );
    },
  },
  {
    name: 'update_visualization',
    title: 'Update visualization',
    description:
      'Change the title, chart kind, columns, aggregate, binning, or selection behavior of an existing visualization. Only supplied fields change. The application rebuilds the query when the kind, aggregate, or any column changes. Prefer this over removing and recreating a chart, which loses its annotations and layout position.',
    schema: toolSchemas.update_visualization,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const existing = deps.getWorkspace().visualizations[input.visualizationId as string];
      const binding = bindingFrom(input, existing?.binding);
      const payload: UpdateVisualizationInput = {
        visualizationId: input.visualizationId as string,
        ...(input.title === undefined ? {} : { title: input.title as string }),
        ...(input.kind === undefined ? {} : { kind: input.kind as VisualizationKind }),
        ...(input.xColumnId === undefined &&
        input.yColumnIds === undefined &&
        input.groupByColumnId === undefined &&
        input.binX === undefined &&
        input.binSeries === undefined
          ? {}
          : { binding }),
        ...(existing === undefined ||
        (input.aggregate === undefined &&
          input.xColumnId === undefined &&
          input.yColumnIds === undefined &&
          input.groupByColumnId === undefined &&
          input.binX === undefined &&
          input.binSeries === undefined &&
          input.kind === undefined)
          ? {}
          : {
              query: queryFrom(
                existing.datasetId,
                input,
                binding,
                (input.kind as VisualizationKind | undefined) ?? existing.kind,
              ),
            }),
        ...(input.linkMode === undefined ? {} : { linkMode: input.linkMode as SelectionLinkMode }),
      };
      return dispatch(
        deps,
        { type: 'visualization.update', payload },
        input.expectedRevision as number,
        ([visualizationId]) => ({ visualizationId }),
      );
    },
  },
  {
    name: 'remove_visualization',
    title: 'Remove visualization',
    description:
      'Delete one visualization and its annotations from the shared workspace. Use update_visualization when you only need to change the chart. The deletion is reversible with undo. Pass expectedRevision to prevent deletion if the workspace changed after you last read it.',
    schema: toolSchemas.remove_visualization,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      return dispatch(
        deps,
        { type: 'visualization.remove', payload: { visualizationId: input.visualizationId as string } },
        input.expectedRevision as number,
      );
    },
  },
  {
    name: 'apply_filter',
    title: 'Apply filter',
    description:
      'Restrict charts, tables, and subsequent reads to rows that match one condition. Nonmatching rows remain in the dataset but are excluded from analysis. Each call adds a filter, so call it several times for a compound condition and use clear_filters to remove filters. Use highlight_selection instead when other rows should remain visible. Returns filterId, which create_metric accepts. The engine binds values as parameters; they never become SQL text.',
    schema: toolSchemas.apply_filter,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      return dispatch(
        deps,
        {
          type: 'filter.apply',
          payload: {
            datasetId: input.datasetId as string,
            columnId: input.columnId as string,
            operator: input.operator as FilterOperator,
            ...(input.value === undefined ? {} : { value: input.value }),
          },
        },
        input.expectedRevision as number,
        ([filterId]) => ({ filterId }),
      );
    },
  },
  {
    name: 'clear_filters',
    title: 'Clear filters',
    description:
      'Remove filters and restore the rows they excluded. Pass datasetId to clear filters for one dataset. Omit it to clear every workspace filter, including filters a human applied. The tool removes all filters in scope; it cannot remove one filter by ID. Call get_workspace first to inspect active filters.',
    schema: toolSchemas.clear_filters,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      return dispatch(
        deps,
        {
          type: 'filters.clear',
          payload: input.datasetId === undefined ? {} : { datasetId: input.datasetId as string },
        },
        input.expectedRevision as number,
      );
    },
  },
  {
    name: 'highlight_selection',
    title: 'Highlight selection',
    description:
      'Emphasize rows whose column value matches one of the supplied values, as if a human selected the corresponding marks. Other rows remain visible but recede, and each chart reacts according to its linkMode. Use apply_filter instead when nonmatching rows should be excluded from analysis. Set additive to extend the current selection instead of replacing it. Use clear_selection to reset it.',
    schema: toolSchemas.highlight_selection,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      return dispatch(
        deps,
        {
          // Both actions use the same payload as a human ctrl-click.
          type: input.additive === true ? 'selection.extend' : 'selection.set',
          payload: {
            datasetId: input.datasetId as string,
            mode: 'predicate',
            predicate: { kind: 'comparison', columnId: input.columnId as string, operator: 'in', value: input.values },
            origin: 'agent',
          },
        },
        input.expectedRevision as number,
        ([selectionId]) => ({ selectionId }),
      );
    },
  },
  {
    name: 'create_metric',
    title: 'Create metric',
    description:
      'Define a named, reusable aggregate that persists in the workspace, such as "Total revenue" or "Month-over-month growth". An optional modifier can calculate percent of total, a running total, or a period-over-period comparison. Use this for a figure that should persist. Use analyze_data for a one-off result. Supply filterIds to bind the metric to a subset independently of active workspace filters.',
    schema: toolSchemas.create_metric,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      return dispatch(
        deps,
        {
          type: 'metric.create',
          payload: {
            datasetId: input.datasetId as string,
            name: input.name as string,
            aggregate: input.aggregate as AggregateFunction,
            ...(input.columnId === undefined ? {} : { columnId: input.columnId as string }),
            ...(input.filterIds === undefined ? {} : { filters: input.filterIds as string[] }),
            ...(input.modifier === undefined ? {} : { modifier: input.modifier as MetricModifier }),
          },
        },
        input.expectedRevision as number,
        ([metricId]) => ({ metricId }),
      );
    },
  },
  {
    name: 'add_annotation',
    title: 'Add annotation',
    description:
      'Attach a short plain-text note to a point, range, or category of an existing chart. Use it to explain a spike, outlier, or other finding. The application stores and renders the note as text, never as markup. Removing the chart also removes its annotations.',
    schema: toolSchemas.add_annotation,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const payload: AddAnnotationInput = {
        visualizationId: input.visualizationId as string,
        text: input.text as string,
        anchor: input.anchor as AnnotationAnchor,
        origin: 'agent',
      };
      return dispatch(
        deps,
        { type: 'annotation.add', payload },
        input.expectedRevision as number,
        ([annotationId]) => ({ annotationId }),
      );
    },
  },
];
