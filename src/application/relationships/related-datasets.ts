import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Maximum relationship hops exposed to callers.
const MAX_REACHABLE_DEPTH = 8;

// Returns datasets reachable from an anchor, excluding the anchor.
export const reachableDatasets = (workspace: Workspace, anchorId: EntityId): Dataset[] => {
  const relationships = Object.values(workspace.relationships);
  const found: Dataset[] = [];
  const visited = new Set<EntityId>([anchorId]);
  let frontier: EntityId[] = [anchorId];

  for (let depth = 0; depth < MAX_REACHABLE_DEPTH && frontier.length > 0; depth += 1) {
    const next: EntityId[] = [];

    for (const datasetId of frontier) {
      for (const relationship of relationships) {
        const neighbour = relatedDatasetId(relationship, datasetId);

        if (neighbour === undefined || visited.has(neighbour)) {
          continue;
        }

        visited.add(neighbour);

        const dataset = workspace.datasets[neighbour];

        if (dataset !== undefined && dataset.importStatus === 'ready') {
          found.push(dataset);
          next.push(neighbour);
        }
      }
    }

    frontier = next;
  }

  return found;
};
