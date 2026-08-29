import type { QueryDataset } from '@/data/compiler/compile-analysis-query.ts';
import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * Join-path resolution.
 *
 * Because cycles are rejected when a relationship is created, the graph is a forest and the path
 * between two datasets is unique when it exists. That is what lets this module walk breadth-first
 * and return the first path found without any tie-breaking rule the caller would have to reason
 * about.
 */

/** One step of a resolved path: the relationship to join, and which side is already in the query. */
export interface JoinStep {
  relationship: Relationship;
  /** The dataset already present in the FROM/JOIN chain when this step runs. */
  fromDatasetId: EntityId;
  /** The dataset this step brings into the query. */
  toDatasetId: EntityId;
}

/** A dataset reachable from the anchor, with the alias the compiler assigns to it. */
export interface JoinPlan {
  /** Ordered joins. Each step's `fromDatasetId` is guaranteed already present when it runs. */
  steps: JoinStep[];
  /** Every dataset in the query, anchor first, in the order they enter the FROM/JOIN chain. */
  datasetIds: EntityId[];
}

/** Depth guard. A path longer than this in an acyclic graph means an implausibly wide schema. */
export const MAX_JOIN_DEPTH = 8;

const noJoinPath = (datasetId: EntityId): DomainError =>
  domainError(
    'NO_JOIN_PATH',
    `Dataset '${datasetId}' is not reachable from the query's anchor dataset. Create a relationship connecting them, then retry.`,
    { datasetId },
  );

/**
 * Finds the relationship chain connecting `anchorId` to `targetId`.
 *
 * Breadth-first, so the returned chain is the shortest — which in an acyclic graph is also the only
 * one. Traversal ignores the direction a relationship was declared in: which dataset a user happened
 * to pick as "left" is a UI detail, not a statement about reachability.
 */
const findPath = (
  anchorId: EntityId,
  targetId: EntityId,
  relationships: readonly Relationship[],
): JoinStep[] | undefined => {
  if (anchorId === targetId) return [];

  const visited = new Set<EntityId>([anchorId]);
  let frontier: { datasetId: EntityId; steps: JoinStep[] }[] = [{ datasetId: anchorId, steps: [] }];

  for (let depth = 0; depth < MAX_JOIN_DEPTH && frontier.length > 0; depth += 1) {
    const next: { datasetId: EntityId; steps: JoinStep[] }[] = [];

    for (const node of frontier) {
      for (const relationship of relationships) {
        const neighbour = relatedDatasetId(relationship, node.datasetId);

        if (neighbour === undefined || visited.has(neighbour)) continue;

        const steps = [...node.steps, { relationship, fromDatasetId: node.datasetId, toDatasetId: neighbour }];

        if (neighbour === targetId) return steps;

        visited.add(neighbour);
        next.push({ datasetId: neighbour, steps });
      }
    }

    frontier = next;
  }

  return undefined;
};

/**
 * Builds the join plan covering every dataset the query references.
 *
 * `requiredDatasetIds` is derived by the caller from the columns the query actually names, so a
 * query that never leaves its anchor produces an empty plan and compiles to exactly the SQL it did
 * before joins existed.
 *
 * When `allowedRelationshipIds` is supplied the search is restricted to those relationships, which
 * is how an explicit `relationshipIds` on the query constrains the path rather than merely
 * annotating it.
 */
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
    if (datasetIds.includes(targetId)) continue;

    const path = findPath(anchorId, targetId, available);

    if (path === undefined) return err(noJoinPath(targetId));

    // A path may traverse datasets already joined by an earlier target. Only the new tail is
    // appended, so each dataset enters the chain exactly once and no relation is joined twice.
    for (const step of path) {
      if (datasetIds.includes(step.toDatasetId)) continue;

      steps.push(step);
      datasetIds.push(step.toDatasetId);
    }
  }

  return ok({ steps, datasetIds });
};

/**
 * Maps each column ID the query names to the dataset that owns it.
 *
 * A column belonging to no known dataset is a caller error rather than an unreachable join, so it is
 * reported by the compiler as `COLUMN_NOT_FOUND` — this function simply omits it.
 */
export const datasetIdsForColumns = (columnIds: readonly EntityId[], datasets: readonly QueryDataset[]): EntityId[] => {
  const owners: EntityId[] = [];

  for (const columnId of columnIds) {
    const owner = datasets.find((dataset) => dataset.columns.some((column) => column.id === columnId));

    if (owner !== undefined && !owners.includes(owner.id)) owners.push(owner.id);
  }

  return owners;
};
