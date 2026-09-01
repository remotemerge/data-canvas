import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { WorkspaceRevision } from '@/domain/workspace/workspace.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Keep selector results referentially stable; derive arrays in useMemo.

export const selectWorkspaceName = (state: WorkspaceState): string => state.workspace.name;

export const selectRevision = (state: WorkspaceState): WorkspaceRevision => state.workspace.revision;

export const selectDatasets = (state: WorkspaceState): Record<EntityId, Dataset> => state.workspace.datasets;

export const selectVisualizations = (state: WorkspaceState): Record<EntityId, Visualization> =>
  state.workspace.visualizations;

export const selectFilters = (state: WorkspaceState): Record<EntityId, Filter> => state.workspace.filters;

// Whether the canvas contains any chart.
export const selectHasVisualizations = (state: WorkspaceState): boolean =>
  Object.keys(state.workspace.visualizations).length > 0;

export const selectActiveDatasetId = (state: WorkspaceState): EntityId | undefined => state.workspace.activeDatasetId;

export const selectLayoutColumns = (state: WorkspaceState): number => state.workspace.layout.columns;

// Returns the stored history array.
export const selectHistory = (state: WorkspaceState): ActionHistoryEntry[] => state.history;

export const selectActiveDataset = (state: WorkspaceState): Dataset | undefined => {
  const { activeDatasetId, datasets } = state.workspace;

  return activeDatasetId === undefined ? undefined : datasets[activeDatasetId];
};

// Returns filters for one dataset as a new array.
export const selectFiltersForDataset = (state: WorkspaceState, datasetId: EntityId): Filter[] =>
  Object.values(state.workspace.filters).filter((filter) => filter.datasetId === datasetId);

export const selectTableSortForDataset = (state: WorkspaceState, datasetId: EntityId) =>
  state.workspace.tableSorts[datasetId] ?? [];
