import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { createDispatcher } from '@/application/actions/dispatcher.ts';
import type { DispatcherDeps } from '@/application/actions/dispatcher.ts';
import type { ApplicationActions } from '@/application/actions/action-types.ts';
import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort, ImportedRelation } from '@/application/ports/data-engine-port.ts';
import { getColumnProfile } from '@/application/queries/column-statistics.ts';
import type { ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { ok } from '@/shared/result/result.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';

// Shared fixtures for application-layer tests.
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
  // Include a second numeric column for derived division tests.
  column('col_units', 'units', 'number'),
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
  linkMode: 'highlight',
  createdBy: 'human',
});

// A workspace holding one ready dataset, the starting point for most action tests.
export const workspaceWithDataset = (): Workspace => {
  const dataset = salesDataset();

  return { ...createEmptyWorkspace('Test workspace'), datasets: { [dataset.id]: dataset } };
};

export const ORDERS_COLUMNS: Column[] = [
  column('col_order_id', 'order_id', 'number'),
  column('col_order_customer', 'customer_id', 'number'),
  column('col_order_revenue', 'revenue', 'number'),
  column('col_order_placed', 'placed_at', 'date'),
];

export const CUSTOMERS_COLUMNS: Column[] = [
  column('col_customer_id', 'id', 'number'),
  column('col_customer_region', 'region', 'category'),
  column('col_customer_name', 'name', 'string'),
];

export const PRODUCTS_COLUMNS: Column[] = [
  column('col_product_id', 'id', 'number'),
  column('col_product_order', 'order_id', 'number'),
  column('col_product_label', 'label', 'string'),
];

const readyDataset = (id: string, name: string, relationId: string, columns: Column[]): Dataset => ({
  id,
  name,
  relationId,
  source: { kind: 'csv', fileName: `${name}.csv`, byteSize: 512, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 100,
  columns,
  revision: 1,
  importStatus: 'ready',
});

export const ordersDataset = (): Dataset => readyDataset('ds_orders', 'orders', 'dataset_orders', ORDERS_COLUMNS);

export const customersDataset = (): Dataset =>
  readyDataset('ds_customers', 'customers', 'dataset_customers', CUSTOMERS_COLUMNS);

export const productsDataset = (): Dataset =>
  readyDataset('ds_products', 'products', 'dataset_products', PRODUCTS_COLUMNS);

// Join fixture with orders, customers, and products.
export const workspaceWithJoinableDatasets = (): Workspace => {
  const orders = ordersDataset();
  const customers = customersDataset();
  const products = productsDataset();

  return {
    ...createEmptyWorkspace('Join workspace'),
    datasets: { [orders.id]: orders, [customers.id]: customers, [products.id]: products },
    activeDatasetId: orders.id,
  };
};

// Stand-in engine for handler tests.
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
  fetchTableWindow: () =>
    Promise.resolve(ok({ rows: [], columnIds: [], columns: [], totalRowCount: 0, offset: 0, stale: false })),
  executeAnalysis: () => Promise.resolve(ok({ rows: [], columns: [] })),
  getDistinctValues: () => Promise.resolve(ok({ values: [], truncated: false })),
  getColumnStatistics: () =>
    Promise.resolve(ok({ rowCount: 0, nullCount: 0, distinctCount: 0, distinctCountCapped: false })),
  getColumnRange: () => Promise.resolve(ok({ min: 0, max: 0 })),
  // Default to a unique key so relationships have no fan-out warning.
  measureKeyQuality: () => Promise.resolve(ok({ sampledRows: 100, distinctKeys: 100 })),
  dropDataset: () => Promise.resolve(ok(undefined)),
});

// Adds the column-statistics dependency used by WebMCP tool tests.
export const stubColumnStatistics =
  (engine: DataEnginePort, workspace: () => Workspace): ToolDependencies['fetchColumnStatistics'] =>
  (request) =>
    getColumnProfile(engine, workspace(), request.datasetId, request.columnId, request.topValueLimit);

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
  const store = createStore<WorkspaceState>()(() => ({ workspace, history: [], undoStack: [], redoStack: [] }));

  return {
    store,
    dispatcher: createDispatcher({ store, dataEngine }),
    workspace: () => store.getState().workspace,
    history: () => store.getState().history,
  };
};

// Runs the import lifecycle through begin and import actions.
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

  if (datasetId === undefined) {
    return { datasetId, result: started };
  }

  return {
    datasetId,
    result: await harness.dispatcher.execute(
      { type: 'dataset.import', payload: { file, datasetId } },
      { actor: 'human' },
    ),
  };
};
