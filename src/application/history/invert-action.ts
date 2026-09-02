import type { ApplicationAction, RestoreWorkspaceInput } from '@/application/actions/action-types.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

const restore = (state: RestoreWorkspaceInput['state'], changedEntityIds: EntityId[]): ApplicationAction => ({
  type: 'history.restore',
  payload: { state, changedEntityIds },
});

// Builds the internal metadata delta used by undo and redo.
export const invertAction = (
  action: ApplicationAction,
  before: Workspace,
  changedEntityIds: EntityId[],
): ApplicationAction | undefined => {
  switch (action.type) {
    case 'filter.apply':
    case 'filter.remove':
    case 'filters.clear':
      return restore({ filters: before.filters }, changedEntityIds);
    case 'visualization.create':
    case 'visualization.update':
    case 'visualization.remove':
      return restore(
        { visualizations: before.visualizations, annotations: before.annotations, layout: before.layout },
        changedEntityIds,
      );
    // A link mode is visualization metadata, so restoring the prior visualizations reverses it.
    case 'visualization.setLinkMode':
      return restore({ visualizations: before.visualizations }, changedEntityIds);
    case 'selection.set':
    case 'selection.extend':
    case 'selection.clear':
      return restore({ selections: before.selections }, changedEntityIds);
    case 'metric.create':
    case 'metric.update':
    case 'metric.remove':
      return restore({ metrics: before.metrics }, changedEntityIds);
    case 'derivedColumn.create':
    case 'derivedColumn.remove':
      return restore({ derivedColumns: before.derivedColumns }, changedEntityIds);
    case 'annotation.add':
    case 'annotation.remove':
      return restore({ annotations: before.annotations }, changedEntityIds);
    case 'layout.update':
      return restore({ layout: before.layout }, changedEntityIds);
    case 'table.sort':
      return restore({ tableSorts: before.tableSorts }, changedEntityIds);
    case 'dataset.setActive':
      return restore({ activeDatasetId: before.activeDatasetId }, changedEntityIds);
    case 'relationship.create':
    case 'relationship.remove':
      return restore({ relationships: before.relationships }, changedEntityIds);
    case 'history.restore': {
      const inverse: RestoreWorkspaceInput['state'] = {};
      for (const key of Object.keys(action.payload.state) as (keyof RestoreWorkspaceInput['state'])[]) {
        Object.assign(inverse, { [key]: before[key] });
      }
      return restore(inverse, action.payload.changedEntityIds);
    }
    // Dataset lifecycle actions cannot be restored from metadata: the source file or relation may be gone.
    case 'dataset.beginImport':
    case 'dataset.import':
    case 'dataset.failImport':
    case 'dataset.remove':
      return undefined;
  }
};
