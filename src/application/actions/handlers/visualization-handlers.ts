import type {
  CreateVisualizationInput,
  RemoveVisualizationInput,
  UpdateVisualizationInput,
} from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { reachableDatasets } from '@/application/relationships/related-datasets.ts';
import { resolveDataset, resolveVisualization } from '@/application/validation/validate-entity-refs.ts';
import { validateVisualization } from '@/application/validation/validate-visualization.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { VisualBinding, Visualization, VisualizationPresentation } from '@/domain/visualization/visualization.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

export const MAX_VISUALIZATION_TITLE_LENGTH = 120;

const DEFAULT_PRESENTATION: VisualizationPresentation = {
  showLegend: true,
  showGrid: true,
  stacked: false,
};

/**
 * Derives an `AnalysisQuery` from a binding when the caller supplies none.
 *
 * Bound `y` channels are the measures and the `x`/`series` channels the dimensions. Deriving it
 * here rather than requiring callers to construct one keeps the human and agent paths equivalent:
 * a UI chart builder and a WebMCP tool both express intent as a binding.
 */
const deriveQuery = (datasetId: string, binding: VisualBinding): AnalysisQuery => ({
  datasetId,
  dimensions: [
    ...(binding.x === undefined ? [] : [binding.x]),
    ...(binding.series === undefined ? [] : [binding.series]),
  ],
  measures: (binding.y ?? []).map((columnId) => ({ columnId, aggregate: 'sum' as const })),
  filters: [],
});

const validateTitle = (title: string): boolean => {
  const trimmed = title.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_VISUALIZATION_TITLE_LENGTH;
};

export const handleCreateVisualization: ActionHandler<CreateVisualizationInput> = (workspace, payload, deps) => {
  if (!validateTitle(payload.title)) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `Visualization title must be between 1 and ${MAX_VISUALIZATION_TITLE_LENGTH} characters.`,
        { maxLength: MAX_VISUALIZATION_TITLE_LENGTH },
      ),
    );
  }

  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) return dataset;

  const compatible = validateVisualization(
    dataset.value,
    payload.kind,
    payload.binding,
    reachableDatasets(workspace, dataset.value.id),
  );

  if (!compatible.ok) return compatible;

  const visualization: Visualization = {
    id: createEntityId(ID_PREFIX.visualization),
    datasetId: dataset.value.id,
    title: payload.title.trim(),
    kind: payload.kind,
    query: payload.query ?? deriveQuery(dataset.value.id, payload.binding),
    binding: payload.binding,
    presentation: { ...DEFAULT_PRESENTATION, ...payload.presentation },
    linkedSelection: payload.linkedSelection ?? true,
    createdBy: deps.actor,
  };

  return ok({
    workspace: {
      ...workspace,
      visualizations: { ...workspace.visualizations, [visualization.id]: visualization },
    },
    changedEntityIds: [visualization.id],
    summary: `Created ${visualization.kind} visualization '${visualization.title}'.`,
  });
};

/**
 * Updates a visualization in place.
 *
 * Omitted fields keep their current value. Kind and binding are validated together against the
 * merged result rather than in isolation, because changing either alone can make a previously valid
 * pair incompatible.
 */
export const handleUpdateVisualization: ActionHandler<UpdateVisualizationInput> = (workspace, payload) => {
  const existing = resolveVisualization(workspace, payload.visualizationId);

  if (!existing.ok) return existing;

  if (payload.title !== undefined && !validateTitle(payload.title)) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `Visualization title must be between 1 and ${MAX_VISUALIZATION_TITLE_LENGTH} characters.`,
        { maxLength: MAX_VISUALIZATION_TITLE_LENGTH },
      ),
    );
  }

  const dataset = resolveDataset(workspace, existing.value.datasetId);

  if (!dataset.ok) return dataset;

  const kind = payload.kind ?? existing.value.kind;
  const binding = payload.binding ?? existing.value.binding;
  const compatible = validateVisualization(
    dataset.value,
    kind,
    binding,
    reachableDatasets(workspace, dataset.value.id),
  );

  if (!compatible.ok) return compatible;

  const updated: Visualization = {
    ...existing.value,
    title: payload.title === undefined ? existing.value.title : payload.title.trim(),
    kind,
    binding,
    // A binding change invalidates a derived query, so it is re-derived unless one was supplied.
    query:
      payload.query ?? (payload.binding === undefined ? existing.value.query : deriveQuery(dataset.value.id, binding)),
    presentation: { ...existing.value.presentation, ...payload.presentation },
    linkedSelection: payload.linkedSelection ?? existing.value.linkedSelection,
  };

  return ok({
    workspace: {
      ...workspace,
      visualizations: { ...workspace.visualizations, [updated.id]: updated },
    },
    changedEntityIds: [updated.id],
    summary: `Updated ${updated.kind} visualization '${updated.title}'.`,
  });
};

/**
 * Removes a visualization together with the annotations anchored to it and its layout slot.
 *
 * Leaving either behind would strand an annotation on a chart that no longer exists and reserve
 * canvas space for nothing.
 */
export const handleRemoveVisualization: ActionHandler<RemoveVisualizationInput> = (workspace, payload) => {
  const visualization = resolveVisualization(workspace, payload.visualizationId);

  if (!visualization.ok) return visualization;

  const orphanedAnnotations = Object.values(workspace.annotations)
    .filter((annotation) => annotation.visualizationId === visualization.value.id)
    .map((annotation) => annotation.id);

  return ok({
    workspace: {
      ...workspace,
      visualizations: omitKeys(workspace.visualizations, [visualization.value.id]),
      annotations: omitKeys(workspace.annotations, orphanedAnnotations),
      layout: {
        ...workspace.layout,
        items: workspace.layout.items.filter((item) => item.visualizationId !== visualization.value.id),
      },
    },
    changedEntityIds: [visualization.value.id, ...orphanedAnnotations],
    summary: `Removed visualization '${visualization.value.title}'.`,
  });
};
