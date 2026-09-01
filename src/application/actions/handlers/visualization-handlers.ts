import type {
  CreateVisualizationInput,
  RemoveVisualizationInput,
  SetVisualizationLinkModeInput,
  UpdateVisualizationInput,
} from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { placeNewVisualization } from '@/application/layout/place-visualization.ts';
import { reachableDatasets } from '@/application/relationships/related-datasets.ts';
import { resolveDataset, resolveVisualization } from '@/application/validation/validate-entity-refs.ts';
import { validateVisualization } from '@/application/validation/validate-visualization.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { VisualBinding, Visualization, VisualizationPresentation } from '@/domain/visualization/visualization.ts';
import { DEFAULT_SELECTION_LINK_MODE } from '@/domain/visualization/selection-link-mode.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

export const MAX_VISUALIZATION_TITLE_LENGTH = 120;

const DEFAULT_PRESENTATION: VisualizationPresentation = {
  showLegend: true,
  showGrid: true,
  stacked: false,
};

// Builds the default `AnalysisQuery` from a visualization binding.
const deriveQuery = (datasetId: string, binding: VisualBinding): AnalysisQuery => {
  // Binned channels must be grouped by bucket, not by their raw values.
  const binned = [
    ...(binding.x === undefined || binding.binX === undefined ? [] : [{ columnId: binding.x, strategy: binding.binX }]),
    ...(binding.series === undefined || binding.binSeries === undefined
      ? []
      : [{ columnId: binding.series, strategy: binding.binSeries }]),
  ];

  return {
    datasetId,
    dimensions: [
      ...(binding.x === undefined || binding.binX !== undefined ? [] : [binding.x]),
      ...(binding.series === undefined || binding.binSeries !== undefined ? [] : [binding.series]),
    ],
    ...(binned.length === 0 ? {} : { binnedDimensions: binned }),
    measures: (binding.y ?? []).map((columnId) => ({ columnId, aggregate: 'sum' as const })),
    filters: [],
  };
};

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

  if (!dataset.ok) {
    return dataset;
  }

  const compatible = validateVisualization(
    dataset.value,
    payload.kind,
    payload.binding,
    reachableDatasets(workspace, dataset.value.id),
  );

  if (!compatible.ok) {
    return compatible;
  }

  const visualization: Visualization = {
    id: createEntityId(ID_PREFIX.visualization),
    datasetId: dataset.value.id,
    title: payload.title.trim(),
    kind: payload.kind,
    query: payload.query ?? deriveQuery(dataset.value.id, payload.binding),
    binding: payload.binding,
    presentation: { ...DEFAULT_PRESENTATION, ...payload.presentation },
    linkMode: payload.linkMode ?? DEFAULT_SELECTION_LINK_MODE,
    createdBy: deps.actor,
  };

  return ok({
    workspace: {
      ...workspace,
      visualizations: { ...workspace.visualizations, [visualization.id]: visualization },
      layout: {
        ...workspace.layout,
        items: placeNewVisualization(workspace.layout.items, visualization.id, workspace.layout.columns),
      },
    },
    changedEntityIds: [visualization.id],
    summary: `Created ${visualization.kind} visualization '${visualization.title}'.`,
  });
};

// Updates a visualization after validating its merged kind and binding.
export const handleUpdateVisualization: ActionHandler<UpdateVisualizationInput> = (workspace, payload) => {
  const existing = resolveVisualization(workspace, payload.visualizationId);

  if (!existing.ok) {
    return existing;
  }

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

  if (!dataset.ok) {
    return dataset;
  }

  const kind = payload.kind ?? existing.value.kind;
  const binding = payload.binding ?? existing.value.binding;
  const compatible = validateVisualization(
    dataset.value,
    kind,
    binding,
    reachableDatasets(workspace, dataset.value.id),
  );

  if (!compatible.ok) {
    return compatible;
  }

  const updated: Visualization = {
    ...existing.value,
    title: payload.title === undefined ? existing.value.title : payload.title.trim(),
    kind,
    binding,
    // A changed binding invalidates the derived query, so rebuild it unless supplied explicitly.
    query:
      payload.query ?? (payload.binding === undefined ? existing.value.query : deriveQuery(dataset.value.id, binding)),
    presentation: { ...existing.value.presentation, ...payload.presentation },
    linkMode: payload.linkMode ?? existing.value.linkMode,
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

// Changes how a visualization responds to selection without changing its binding.
export const handleSetVisualizationLinkMode: ActionHandler<SetVisualizationLinkModeInput> = (workspace, payload) => {
  const existing = resolveVisualization(workspace, payload.visualizationId);

  if (!existing.ok) {
    return existing;
  }

  const updated: Visualization = { ...existing.value, linkMode: payload.linkMode };

  return ok({
    workspace: {
      ...workspace,
      visualizations: { ...workspace.visualizations, [updated.id]: updated },
    },
    changedEntityIds: [updated.id],
    summary: `Set '${updated.title}' to ${payload.linkMode} selection linking.`,
  });
};

// Removes a visualization, its anchored annotations, and its layout item.
export const handleRemoveVisualization: ActionHandler<RemoveVisualizationInput> = (workspace, payload) => {
  const visualization = resolveVisualization(workspace, payload.visualizationId);

  if (!visualization.ok) {
    return visualization;
  }

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
