import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

const MAX_PROPAGATION_DEPTH = 8;

export const propagationPath = (
  workspace: Workspace,
  fromDatasetId: EntityId,
  toDatasetId: EntityId,
): Relationship[] | undefined => {
  if (fromDatasetId === toDatasetId) {
    return [];
  }

  interface Step {
    datasetId: EntityId;
    path: Relationship[];
  }

  const relationships = Object.values(workspace.relationships);
  const visited = new Set<EntityId>([fromDatasetId]);

  /*
   * Expands one frontier entry. Returning the completed path signals that the target was reached, so
   * the caller stops rather than exploring the rest of the level.
   */
  const stepFrom = (entry: Step): { found: Relationship[] } | { next: Step[] } => {
    const next: Step[] = [];

    for (const relationship of relationships) {
      const neighbour = relatedDatasetId(relationship, entry.datasetId);

      if (neighbour === undefined || visited.has(neighbour)) {
        continue;
      }

      const path = [...entry.path, relationship];

      if (neighbour === toDatasetId) {
        return { found: path };
      }

      visited.add(neighbour);
      next.push({ datasetId: neighbour, path });
    }

    return { next };
  };

  let frontier: Step[] = [{ datasetId: fromDatasetId, path: [] }];

  for (let depth = 0; depth < MAX_PROPAGATION_DEPTH && frontier.length > 0; depth += 1) {
    const expanded: Step[] = [];

    for (const entry of frontier) {
      const outcome = stepFrom(entry);

      if ('found' in outcome) {
        return outcome.found;
      }

      expanded.push(...outcome.next);
    }

    frontier = expanded;
  }

  return undefined;
};

export const isWithinSelectionScope = (workspace: Workspace, fromDatasetId: EntityId, toDatasetId: EntityId): boolean =>
  propagationPath(workspace, fromDatasetId, toDatasetId) !== undefined;
