import { propagationPath } from '@/application/selection/selection-scope.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';

/**
 * What a selection means for one visualization.
 *
 * `filter` carries a predicate the query compiler applies; `highlight` carries one the renderer uses
 * to dim unselected marks without changing the query. Keeping both as the same predicate shape means
 * the two modes cannot disagree about *which* rows are selected — only about what to do with them.
 */
export interface PropagatedSelection {
  effect: 'none' | 'highlight' | 'filter';
  predicate?: FilterExpression;
}

const NO_EFFECT: PropagatedSelection = { effect: 'none' };

/**
 * Resolves the selection applying to a visualization.
 *
 * Three gates, in order. A chart with `linkMode: 'none'` ignores selection outright. A selection on
 * the chart's own dataset applies directly. A selection on another dataset applies only when a
 * relationship path connects the two — the scope rule from `selection-scope`.
 *
 * Cross-dataset propagation reuses the relationship graph rather than introducing a second join
 * mechanism: the predicate is handed to the compiler with the anchor's own relationship resolution,
 * which is what makes it a semi-join through the declared path rather than an invented correlation.
 */
export const propagateSelection = (workspace: Workspace, visualization: Visualization): PropagatedSelection => {
  if (visualization.linkMode === 'none') return NO_EFFECT;

  const selections = Object.values(workspace.selections);

  if (selections.length === 0) return NO_EFFECT;

  const own = selections.find((selection) => selection.datasetId === visualization.datasetId);
  const applicable = own ?? selections.find((selection) => reaches(workspace, selection, visualization));

  if (applicable === undefined) return NO_EFFECT;

  const predicate = selectionPredicate(applicable);

  if (predicate === undefined) return NO_EFFECT;

  return { effect: visualization.linkMode, predicate };
};

const reaches = (workspace: Workspace, selection: Selection, visualization: Visualization): boolean =>
  propagationPath(workspace, selection.datasetId, visualization.datasetId) !== undefined;

/**
 * The predicate form of a selection.
 *
 * A `keys` selection has no column-level predicate to hand a chart on another dataset, so only
 * predicate-mode selections propagate. This is why chart interactions produce predicates: a category
 * click is "region = EU", which is meaningful across a join, where a list of row keys is not.
 */
export const selectionPredicate = (selection: Selection): FilterExpression | undefined => selection.predicate;
