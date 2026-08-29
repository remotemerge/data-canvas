import type {
  AddAnnotationInput,
  CreateVisualizationInput,
  UpdateVisualizationInput,
} from '@/application/actions/action-types.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import type { FilterOperator } from '@/domain/filter/filter.ts';
import type { VisualizationKind, VisualBinding } from '@/domain/visualization/visualization.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { ToolDependencies, DataCanvasTool } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { createCreateRelationshipTool } from '@/webmcp/tools/write/create-relationship.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

const dispatch = async (
  deps: ToolDependencies,
  action: Parameters<ToolDependencies['dispatcher']['execute']>[0],
  expectedRevision: number | undefined,
  extra: (changedIds: string[]) => Record<string, unknown> = () => ({}),
): Promise<string> => {
  const result = await deps.dispatcher.execute(action, { actor: 'agent', expectedRevision });
  if (!result.ok) return failure(result.error);
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
});

const queryFrom = (datasetId: string, input: ReturnType<typeof asInput>, binding: VisualBinding): AnalysisQuery => ({
  datasetId,
  dimensions: [...new Set([binding.x, binding.series].filter((id): id is string => id !== undefined))],
  measures:
    binding.y === undefined || binding.y.length === 0
      ? [{ aggregate: 'count' }]
      : binding.y.map((columnId) => ({
          columnId,
          aggregate: (input.aggregate as AggregateFunction | undefined) ?? 'sum',
        })),
  filters: [],
});

export const createWriteTools = (deps: ToolDependencies): DataCanvasTool[] => [
  createCreateRelationshipTool(deps),
  {
    name: 'create_visualization',
    description: 'Create a semantic chart, KPI, or table in the shared workspace.',
    schema: toolSchemas.create_visualization,
    annotations: { readOnlyHint: false },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const datasetId = input.datasetId as string;
      const binding = bindingFrom(input);
      const payload: CreateVisualizationInput = {
        datasetId,
        title: input.title as string,
        kind: input.kind as VisualizationKind,
        binding,
        query: queryFrom(datasetId, input, binding),
      };
      return dispatch(
        deps,
        { type: 'visualization.create', payload },
        input.expectedRevision as number,
        ([visualizationId]) => ({ visualizationId }),
      );
    },
  },
  {
    name: 'update_visualization',
    description: 'Update an existing visualization through the same application action used by the UI.',
    schema: toolSchemas.update_visualization,
    annotations: { readOnlyHint: false },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const existing = deps.getWorkspace().visualizations[input.visualizationId as string];
      const binding = bindingFrom(input, existing?.binding);
      const payload: UpdateVisualizationInput = {
        visualizationId: input.visualizationId as string,
        ...(input.title === undefined ? {} : { title: input.title as string }),
        ...(input.kind === undefined ? {} : { kind: input.kind as VisualizationKind }),
        ...(input.xColumnId === undefined && input.yColumnIds === undefined && input.groupByColumnId === undefined
          ? {}
          : { binding }),
        ...(existing === undefined ||
        (input.aggregate === undefined &&
          input.xColumnId === undefined &&
          input.yColumnIds === undefined &&
          input.groupByColumnId === undefined)
          ? {}
          : { query: queryFrom(existing.datasetId, input, binding) }),
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
    description: 'Remove one visualization and its attached annotations from the shared workspace.',
    schema: toolSchemas.remove_visualization,
    annotations: { readOnlyHint: false },
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
    description: 'Apply a validated semantic filter to a dataset. Values never become SQL text.',
    schema: toolSchemas.apply_filter,
    annotations: { readOnlyHint: false },
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
    description: 'Clear every filter or only filters belonging to one dataset.',
    schema: toolSchemas.clear_filters,
    annotations: { readOnlyHint: false },
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
    description: 'Highlight a bounded set of values using a semantic selection predicate.',
    schema: toolSchemas.highlight_selection,
    annotations: { readOnlyHint: false },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      return dispatch(
        deps,
        {
          type: 'selection.set',
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
    description: 'Create a named aggregate metric from a dataset and optional stored filters.',
    schema: toolSchemas.create_metric,
    annotations: { readOnlyHint: false },
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
          },
        },
        input.expectedRevision as number,
        ([metricId]) => ({ metricId }),
      );
    },
  },
  {
    name: 'add_annotation',
    description: 'Add plain-text explanatory annotation to an existing visualization.',
    schema: toolSchemas.add_annotation,
    annotations: { readOnlyHint: false },
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
