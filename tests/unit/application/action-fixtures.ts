import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { createDispatcher } from '@/application/actions/dispatcher.ts';
import type { DispatcherDeps } from '@/application/actions/dispatcher.ts';
import type { ApplicationActions } from '@/application/actions/action-types.ts';
import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort, ImportedRelation } from '@/application/ports/data-engine-port.ts';
import { ok } from '@/shared/result/result.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
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

/**
 * A stand-in engine for handler tests.
 *
 * Handler logic is independent of DuckDB, so these tests must not need a worker. The real engine is
 * exercised in the browser, where it can actually run.
 */
export const stubDataEngine = (
  importFile: DataEnginePort['importFile'] = (_file, datasetId) =>
    Promise.resolve(
      ok<ImportedRelation>({
        relationId: `dataset_${datasetId.slice(-4)}`,
        rowCount: 42,
        columns: [column('col_a', 'a', 'number')],
      }),
    ),
): DataEnginePort => ({
  importFile,
  fetchTableWindow: () => Promise.resolve(ok({ rows: [], columnIds: [], offset: 0, stale: false })),
});

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

/**
 * Runs the full import lifecycle: commit the `loading` placeholder, then resolve it.
 *
 * Tests go through both actions rather than calling `dataset.import` alone, because an import that
 * skips the placeholder is not a path the application has — the handler rejects a dataset that is
 * not already loading.
 */
export const importThroughDispatcher = async (
  harness: TestHarness,
  file: unknown,
  name = 'Sales',
): Promise<{
  datasetId: EntityId | undefined;
  result: Awaited<ReturnType<ApplicationActions['execute']>>;
}> => {
  const started = await harness.dispatcher.execute(
    { type: 'dataset.beginImport', payload: { name, sourceKind: 'csv', byteSize: 1024 } },
    { actor: 'human' },
  );

  const datasetId = started.ok ? started.value.changedEntityIds[0] : undefined;

  if (datasetId === undefined) return { datasetId, result: started };

  return {
    datasetId,
    result: await harness.dispatcher.execute(
      { type: 'dataset.import', payload: { file, datasetId } },
      { actor: 'human' },
    ),
  };
};
