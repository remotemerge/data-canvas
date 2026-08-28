import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { createDispatcher } from '@/application/actions/dispatcher.ts';
import type { DispatcherDeps } from '@/application/actions/dispatcher.ts';
import type { ApplicationActions } from '@/application/actions/action-types.ts';
import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';

/*
 * Shared fixtures for application-layer tests.
 *
 * Tests build an isolated store per case rather than sharing the application singleton, so a
 * concurrency test cannot be perturbed by another file's state.
 */

export const column = (id: string, name: string, logicalType: LogicalType): Column => ({
  id,
  name,
  physicalName: name,
  databaseType: logicalType.toUpperCase(),
  logicalType,
  nullable: true,
});

export const SALES_COLUMNS: Column[] = [
  column('col_date', 'order_date', 'date'),
  column('col_region', 'region', 'category'),
  column('col_notes', 'notes', 'string'),
  column('col_revenue', 'revenue', 'number'),
  column('col_returned', 'returned', 'boolean'),
];

export const salesDataset = (id = 'ds_sales'): Dataset => ({
  id,
  name: 'Sales',
  relationId: 'dataset_0001',
  source: { kind: 'csv', fileName: 'sales.csv', byteSize: 1024, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 1000,
  columns: SALES_COLUMNS,
  revision: 0,
  importStatus: 'ready',
});

export const visualization = (id: string, datasetId: string): Visualization => ({
  id,
  datasetId,
  title: 'Revenue over time',
  kind: 'line',
  query: {
    datasetId,
    dimensions: ['col_date'],
    measures: [{ columnId: 'col_revenue', aggregate: 'sum' }],
    filters: [],
  },
  binding: { x: 'col_date', y: ['col_revenue'] },
  presentation: { showLegend: true, showGrid: true, stacked: false },
  linkedSelection: true,
});

/** A workspace holding one ready dataset, the starting point for most action tests. */
export const workspaceWithDataset = (): Workspace => {
  const dataset = salesDataset();

  return { ...createEmptyWorkspace('Test workspace'), datasets: { [dataset.id]: dataset } };
};

export interface TestHarness {
  store: StoreApi<WorkspaceState>;
  dispatcher: ApplicationActions;
  workspace: () => Workspace;
  history: () => WorkspaceState['history'];
}

export const createHarness = (
  workspace: Workspace = workspaceWithDataset(),
  dataEngine: DispatcherDeps['dataEngine'] = unavailableDataEngine,
): TestHarness => {
  const store = createStore<WorkspaceState>()(() => ({ workspace, history: [] }));

  return {
    store,
    dispatcher: createDispatcher({ store, dataEngine }),
    workspace: () => store.getState().workspace,
    history: () => store.getState().history,
  };
};
