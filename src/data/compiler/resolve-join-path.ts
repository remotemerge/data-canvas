import type { QueryDataset } from '@/data/compiler/compile-analysis-query.ts';
import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Resolves relationship paths through the acyclic dataset graph.

// One step in a resolved join path.
export interface JoinStep {
  relationship: Relationship;
  // Dataset already present in the join chain.
  fromDatasetId: EntityId;
  // Dataset added by this step.
  toDatasetId: EntityId;
}

// Dataset reachable from the anchor with its compiler alias.
export interface JoinPlan {
  // Ordered joins; each step starts from a dataset already in the chain.
  steps: JoinStep[];
  // Query datasets in FROM/JOIN order, anchor first.
  datasetIds: EntityId[];
}

// Maximum relationship hops in a resolved path.
export const MAX_JOIN_DEPTH = 8;

const noJoinPath = (datasetId: EntityId): DomainError =>
  domainError(
    'NO_JOIN_PATH',
    `Dataset '${datasetId}' is not reachable from the query's anchor dataset. Create a relationship connecting them, then retry.`,
    { datasetId },
  );

// Finds the relationship chain connecting two datasets.
const findPath = (
  anchorId: EntityId,
  targetId: EntityId,
  relationships: readonly Relationship[],
): JoinStep[] | undefined => {
  const visited = new Set<EntityId>([anchorId]);
  let frontier: { datasetId: EntityId; steps: JoinStep[] }[] = [{ datasetId: anchorId, steps: [] }];

  for (let depth = 0; depth < MAX_JOIN_DEPTH && frontier.length > 0; depth += 1) {
    const next: { datasetId: EntityId; steps: JoinStep[] }[] = [];

    for (const node of frontier) {
      for (const relationship of relationships) {
        const neighbour = relatedDatasetId(relationship, node.datasetId);

        if (neighbour === undefined || visited.has(neighbour)) {
          continue;
        }

        const steps = [...node.steps, { relationship, fromDatasetId: node.datasetId, toDatasetId: neighbour }];

        if (neighbour === targetId) {
          return steps;
        }

        visited.add(neighbour);
        next.push({ datasetId: neighbour, steps });
      }
    }

    frontier = next;
  }

  return undefined;
};

// Builds a join plan for every dataset referenced by a query.
export const resolveJoinPath = (
  anchorId: EntityId,
  requiredDatasetIds: readonly EntityId[],
  relationships: readonly Relationship[],
  allowedRelationshipIds?: readonly EntityId[],
): Result<JoinPlan, DomainError> => {
  const available =
    allowedRelationshipIds === undefined
      ? relationships
      : relationships.filter((relationship) => allowedRelationshipIds.includes(relationship.id));

  if (allowedRelationshipIds !== undefined) {
    const missing = allowedRelationshipIds.find((id) => !relationships.some((relationship) => relationship.id === id));

    if (missing !== undefined) {
      return err(
        domainError('NO_JOIN_PATH', `No relationship with id '${missing}' exists in this workspace.`, {
          relationshipId: missing,
        }),
      );
    }
  }

  const steps: JoinStep[] = [];
  const datasetIds: EntityId[] = [anchorId];

  for (const targetId of requiredDatasetIds) {
    if (datasetIds.includes(targetId)) {
      continue;
    }

    const path = findPath(anchorId, targetId, available);

    if (path === undefined) {
      return err(noJoinPath(targetId));
    }

    // Append only the new tail so each dataset enters the chain once.
    for (const step of path) {
      if (datasetIds.includes(step.toDatasetId)) {
        continue;
      }

      steps.push(step);
      datasetIds.push(step.toDatasetId);
    }
  }

  return ok({ steps, datasetIds });
};

// Maps known column IDs to their owning datasets.
export const datasetIdsForColumns = (columnIds: readonly EntityId[], datasets: readonly QueryDataset[]): EntityId[] => {
  const owners: EntityId[] = [];

  for (const columnId of columnIds) {
    const owner = datasets.find((dataset) => dataset.columns.some((column) => column.id === columnId));

    if (owner !== undefined && !owners.includes(owner.id)) {
      owners.push(owner.id);
    }
  }

  return owners;
};
