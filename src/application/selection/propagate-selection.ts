import { propagationPath } from '@/application/selection/selection-scope.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';

// Selection behavior for a visualization.
export interface PropagatedSelection {
  effect: 'none' | 'highlight' | 'filter';
  predicate?: FilterExpression;
}

const NO_EFFECT: PropagatedSelection = { effect: 'none' };

// Resolves the selection predicate that applies to a visualization.
export const propagateSelection = (workspace: Workspace, visualization: Visualization): PropagatedSelection => {
  if (visualization.linkMode === 'none') {
    return NO_EFFECT;
  }

  const selections = Object.values(workspace.selections);

  if (selections.length === 0) {
    return NO_EFFECT;
  }

  const own = selections.find((selection) => selection.datasetId === visualization.datasetId);
  const applicable = own ?? selections.find((selection) => reaches(workspace, selection, visualization));

  if (applicable === undefined) {
    return NO_EFFECT;
  }

  const predicate = selectionPredicate(applicable);

  if (predicate === undefined) {
    return NO_EFFECT;
  }

  return { effect: visualization.linkMode, predicate };
};

const reaches = (workspace: Workspace, selection: Selection, visualization: Visualization): boolean =>
  propagationPath(workspace, selection.datasetId, visualization.datasetId) !== undefined;

// Returns the predicate form of a selection, if it can cross a relationship.
export const selectionPredicate = (selection: Selection): FilterExpression | undefined => selection.predicate;
