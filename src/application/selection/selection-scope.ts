import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Maximum relationship hops allowed for selection propagation.
const MAX_PROPAGATION_DEPTH = 8;

// Finds the relationship chain between two datasets, if one exists.
export const propagationPath = (
  workspace: Workspace,
  fromDatasetId: EntityId,
  toDatasetId: EntityId,
): Relationship[] | undefined => {
  if (fromDatasetId === toDatasetId) {
    return [];
  }

  const relationships = Object.values(workspace.relationships);
  const visited = new Set<EntityId>([fromDatasetId]);
  let frontier: { datasetId: EntityId; path: Relationship[] }[] = [{ datasetId: fromDatasetId, path: [] }];

  for (let depth = 0; depth < MAX_PROPAGATION_DEPTH && frontier.length > 0; depth += 1) {
    const next: { datasetId: EntityId; path: Relationship[] }[] = [];

    for (const entry of frontier) {
      for (const relationship of relationships) {
        const neighbour = relatedDatasetId(relationship, entry.datasetId);

        if (neighbour === undefined || visited.has(neighbour)) {
          continue;
        }

        const path = [...entry.path, relationship];

        if (neighbour === toDatasetId) {
          return path;
        }

        visited.add(neighbour);
        next.push({ datasetId: neighbour, path });
      }
    }

    frontier = next;
  }

  return undefined;
};

// Returns whether selection can propagate between two datasets.
export const isWithinSelectionScope = (workspace: Workspace, fromDatasetId: EntityId, toDatasetId: EntityId): boolean =>
  propagationPath(workspace, fromDatasetId, toDatasetId) !== undefined;
