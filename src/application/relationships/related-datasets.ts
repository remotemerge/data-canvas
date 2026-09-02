import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

const MAX_REACHABLE_DEPTH = 8;

export const reachableDatasets = (workspace: Workspace, anchorId: EntityId): Dataset[] => {
  const relationships = Object.values(workspace.relationships);
  const found: Dataset[] = [];
  const visited = new Set<EntityId>([anchorId]);

  /*
   * Collects the unvisited datasets one hop from `datasetId`. Only datasets that finished importing
   * continue the walk, so an in-flight import does not bridge two otherwise unrelated datasets.
   */
  const stepFrom = (datasetId: EntityId): EntityId[] => {
    const reached: EntityId[] = [];

    for (const relationship of relationships) {
      const neighbour = relatedDatasetId(relationship, datasetId);

      if (neighbour === undefined || visited.has(neighbour)) {
        continue;
      }

      visited.add(neighbour);

      const dataset = workspace.datasets[neighbour];

      if (dataset?.importStatus === 'ready') {
        found.push(dataset);
        reached.push(neighbour);
      }
    }

    return reached;
  };

  let frontier: EntityId[] = [anchorId];

  for (let depth = 0; depth < MAX_REACHABLE_DEPTH && frontier.length > 0; depth += 1) {
    frontier = frontier.flatMap(stepFrom);
  }

  return found;
};
