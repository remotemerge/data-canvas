import type {
  CreateRelationshipInput,
  RemoveDatasetInput,
  RemoveRelationshipInput,
} from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import {
  describeFanOutRisk,
  KEY_QUALITY_SAMPLE_ROWS,
  validateRelationship,
} from '@/application/validation/validate-relationship.ts';
import type { KeyQualityMeasurement } from '@/application/validation/validate-relationship.ts';
import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

/**
 * Creates a governed relationship between two datasets.
 *
 * Structural validation runs first and rejects; the key-quality sample runs second and only warns.
 * The split matters: a type mismatch is a definite error, whereas key duplication measured over a
 * bounded sample is evidence. Refusing on evidence would block legitimate joins over data the sample
 * happened to miss, so the measurement is surfaced in the summary and the relationship is committed.
 */
export const handleCreateRelationship: ActionHandler<CreateRelationshipInput> = async (workspace, payload, deps) => {
  const validated = validateRelationship(workspace, payload);

  if (!validated.ok) return validated;

  const { leftDataset, rightDataset, keys } = validated.value;

  const measured = await deps.dataEngine.measureKeyQuality({
    datasetId: rightDataset.id,
    columnIds: keys.map((key) => key.right.id),
    sampleRows: KEY_QUALITY_SAMPLE_ROWS,
  });

  // A key-quality read that fails costs the warning, not the action. The engine may legitimately be
  // unavailable, and a relationship the user can still inspect beats a refusal they cannot act on.
  const measurement: KeyQualityMeasurement | undefined =
    measured.ok && measured.value.distinctKeys > 0
      ? {
          sampledRows: measured.value.sampledRows,
          distinctKeys: measured.value.distinctKeys,
          rowsPerKey: measured.value.sampledRows / measured.value.distinctKeys,
        }
      : undefined;

  const warning = measurement === undefined ? undefined : describeFanOutRisk(payload.kind, measurement);

  const relationship: Relationship = {
    id: createEntityId(ID_PREFIX.relationship),
    leftDatasetId: leftDataset.id,
    rightDatasetId: rightDataset.id,
    on: keys.map((key) => ({ leftColumnId: key.left.id, rightColumnId: key.right.id })),
    kind: payload.kind,
    join: payload.join,
    createdBy: deps.actor,
  };

  return ok({
    workspace: {
      ...workspace,
      relationships: { ...workspace.relationships, [relationship.id]: relationship },
    },
    changedEntityIds: [relationship.id],
    summary: `Related '${leftDataset.name}' to '${rightDataset.name}' on ${keys.length} key column${keys.length === 1 ? '' : 's'} using a ${relationship.join} join.${warning === undefined ? '' : ` ${warning}`}`,
  });
};

/**
 * Removes a relationship.
 *
 * Visualizations whose queries crossed it are left in place. They fail at query time with
 * `NO_JOIN_PATH`, which names the unreachable dataset and is more useful than deleting a chart the
 * user may want to repair by recreating the relationship.
 */
export const handleRemoveRelationship: ActionHandler<RemoveRelationshipInput> = (workspace, payload) => {
  const relationship = workspace.relationships[payload.relationshipId];

  if (relationship === undefined) {
    return err(
      domainError('UNSUPPORTED_OPERATION', `No relationship with id '${payload.relationshipId}' exists.`, {
        relationshipId: payload.relationshipId,
      }),
    );
  }

  const left = workspace.datasets[relationship.leftDatasetId]?.name ?? relationship.leftDatasetId;
  const right = workspace.datasets[relationship.rightDatasetId]?.name ?? relationship.rightDatasetId;

  return ok({
    workspace: { ...workspace, relationships: omitKeys(workspace.relationships, [relationship.id]) },
    changedEntityIds: [relationship.id],
    summary: `Removed the relationship between '${left}' and '${right}'.`,
  });
};

/** Everything in the workspace that would be orphaned by removing a dataset. */
interface DatasetDependents {
  visualizationIds: EntityId[];
  filterIds: EntityId[];
  metricIds: EntityId[];
  selectionIds: EntityId[];
  relationshipIds: EntityId[];
  annotationIds: EntityId[];
}

/**
 * Collects every entity that references a dataset, directly or through a visualization.
 *
 * Annotations are included transitively: they anchor to a visualization, so a chart removed by the
 * cascade would strand them exactly as `visualization.remove` avoids doing.
 */
const collectDependents = (workspace: Workspace, datasetId: EntityId): DatasetDependents => {
  const visualizationIds = Object.values(workspace.visualizations)
    .filter((visualization) => visualization.datasetId === datasetId || visualization.query.datasetId === datasetId)
    .map((visualization) => visualization.id);

  return {
    visualizationIds,
    filterIds: Object.values(workspace.filters)
      .filter((filter) => filter.datasetId === datasetId)
      .map((filter) => filter.id),
    metricIds: Object.values(workspace.metrics)
      .filter((metric) => metric.datasetId === datasetId)
      .map((metric) => metric.id),
    selectionIds: Object.values(workspace.selections)
      .filter((selection) => selection.datasetId === datasetId)
      .map((selection) => selection.id),
    relationshipIds: Object.values(workspace.relationships)
      .filter((relationship) => relatedDatasetId(relationship, datasetId) !== undefined)
      .map((relationship) => relationship.id),
    annotationIds: Object.values(workspace.annotations)
      .filter((annotation) => visualizationIds.includes(annotation.visualizationId))
      .map((annotation) => annotation.id),
  };
};

const dependentCount = (dependents: DatasetDependents): number =>
  Object.values(dependents).reduce((total, ids) => total + ids.length, 0);

/**
 * Removes a dataset, its DuckDB relation, and — with `cascade` — everything referencing it.
 *
 * Without `cascade` a referenced dataset is refused, with the counts stated. Silent orphaning is the
 * failure mode this exists to prevent: a chart pointing at a dataset that no longer exists renders
 * an error the user cannot explain, and a filter on a missing column is invisible.
 */
export const handleRemoveDataset: ActionHandler<RemoveDatasetInput> = async (workspace, payload, deps) => {
  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) return dataset;

  const dependents = collectDependents(workspace, dataset.value.id);
  const total = dependentCount(dependents);

  if (total > 0 && payload.cascade !== true) {
    return err(
      domainError(
        'DATASET_IN_USE',
        `Dataset '${dataset.value.name}' is referenced by ${dependents.visualizationIds.length} visualizations, ${dependents.filterIds.length} filters, ${dependents.metricIds.length} metrics, and ${dependents.relationshipIds.length} relationships. Remove them first, or retry with cascade to remove them together.`,
        {
          datasetId: dataset.value.id,
          visualizations: dependents.visualizationIds.length,
          filters: dependents.filterIds.length,
          metrics: dependents.metricIds.length,
          selections: dependents.selectionIds.length,
          relationships: dependents.relationshipIds.length,
        },
      ),
    );
  }

  // The relation is dropped before the commit so a failure leaves the dataset in the workspace
  // rather than leaving workspace metadata describing a relation that is already gone.
  const dropped = await deps.dataEngine.dropDataset(dataset.value.id);

  if (!dropped.ok) return dropped;

  const { activeDatasetId, ...rest } = workspace;
  // A removed active dataset hands over to any surviving one rather than clearing: leaving the
  // workspace with no active dataset would blank the canvas even though data remains.
  const nextActive =
    activeDatasetId === dataset.value.id
      ? Object.keys(workspace.datasets).find((id) => id !== dataset.value.id)
      : activeDatasetId;

  const { [dataset.value.id]: _removedSort, ...tableSorts } = workspace.tableSorts;

  return ok({
    workspace: {
      ...rest,
      ...(nextActive === undefined ? {} : { activeDatasetId: nextActive }),
      datasets: omitKeys(workspace.datasets, [dataset.value.id]),
      relationships: omitKeys(workspace.relationships, dependents.relationshipIds),
      visualizations: omitKeys(workspace.visualizations, dependents.visualizationIds),
      filters: omitKeys(workspace.filters, dependents.filterIds),
      metrics: omitKeys(workspace.metrics, dependents.metricIds),
      selections: omitKeys(workspace.selections, dependents.selectionIds),
      annotations: omitKeys(workspace.annotations, dependents.annotationIds),
      tableSorts,
      layout: {
        ...workspace.layout,
        items: workspace.layout.items.filter((item) => !dependents.visualizationIds.includes(item.visualizationId)),
      },
    },
    changedEntityIds: [
      dataset.value.id,
      ...dependents.relationshipIds,
      ...dependents.visualizationIds,
      ...dependents.filterIds,
      ...dependents.metricIds,
      ...dependents.selectionIds,
      ...dependents.annotationIds,
    ],
    summary:
      total === 0
        ? `Removed dataset '${dataset.value.name}'.`
        : `Removed dataset '${dataset.value.name}' and ${total} entities that referenced it.`,
  });
};
