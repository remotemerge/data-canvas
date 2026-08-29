import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/** Matches the join resolver's bound, so a selection never claims to reach further than a query can. */
const MAX_PROPAGATION_DEPTH = 8;

/**
 * The relationship chain from the selection's dataset to a target dataset.
 *
 * Returns `undefined` when no chain exists. That absence is the whole scope rule: a selection on one
 * dataset means nothing to an unrelated one, because there is no defined correspondence between
 * their rows. Propagating anyway would silently filter a chart by a predicate over columns it does
 * not have.
 *
 * Breadth-first over an acyclic graph, so the first chain found is the only one — the same property
 * `resolve-join-path` relies on, and the reason this returns a single path rather than a set.
 */
export const propagationPath = (
  workspace: Workspace,
  fromDatasetId: EntityId,
  toDatasetId: EntityId,
): Relationship[] | undefined => {
  if (fromDatasetId === toDatasetId) return [];

  const relationships = Object.values(workspace.relationships);
  const visited = new Set<EntityId>([fromDatasetId]);
  let frontier: { datasetId: EntityId; path: Relationship[] }[] = [{ datasetId: fromDatasetId, path: [] }];

  for (let depth = 0; depth < MAX_PROPAGATION_DEPTH && frontier.length > 0; depth += 1) {
    const next: { datasetId: EntityId; path: Relationship[] }[] = [];

    for (const entry of frontier) {
      for (const relationship of relationships) {
        const neighbour = relatedDatasetId(relationship, entry.datasetId);

        if (neighbour === undefined || visited.has(neighbour)) continue;

        const path = [...entry.path, relationship];

        if (neighbour === toDatasetId) return path;

        visited.add(neighbour);
        next.push({ datasetId: neighbour, path });
      }
    }

    frontier = next;
  }

  return undefined;
};

/** True when a selection on one dataset has a defined meaning for another. */
export const isWithinSelectionScope = (workspace: Workspace, fromDatasetId: EntityId, toDatasetId: EntityId): boolean =>
  propagationPath(workspace, fromDatasetId, toDatasetId) !== undefined;
