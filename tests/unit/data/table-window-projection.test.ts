import { describe, expect, test } from 'bun:test';
import { handleCreateDerivedColumn } from '@/application/actions/handlers/derived-column-handlers.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';

const datasetId = 'ds_projection' as EntityId;
const salesId = 'col_sales' as EntityId;
const profitId = 'col_profit' as EntityId;

const dataset: Dataset = {
  id: datasetId,
  name: 'orders',
  relationId: 'rel_orders',
  source: { kind: 'csv', fileName: 'orders.csv', byteSize: 128, importedAt: '2026-01-01T00:00:00.000Z' },
  rowCount: 2,
  revision: 1,
  importStatus: 'ready',
  columns: [
    {
      id: salesId,
      name: 'Sales',
      physicalName: 'c0',
      databaseType: 'DOUBLE',
      logicalType: 'number',
      nullable: true,
    },
    {
      id: profitId,
      name: 'Profit',
      physicalName: 'c1',
      databaseType: 'DOUBLE',
      logicalType: 'number',
      nullable: true,
    },
  ],
};

const workspaceWithDataset = { ...createEmptyWorkspace(), datasets: { [datasetId]: dataset } };

const projectionKey = (columns: Dataset['columns']): string => columns.map((column) => column.id).join(',');

const createMargin = async () =>
  await handleCreateDerivedColumn(
    workspaceWithDataset,
    {
      datasetId,
      name: 'Margin',
      expression: {
        kind: 'arithmetic',
        op: 'div',
        left: { kind: 'column', columnId: profitId },
        right: { kind: 'column', columnId: salesId },
      },
    },
    { dataEngine: registeredDataEngine, actor: 'human' },
  );

describe('table window refetch key', () => {
  test('a new derived column widens the projection without advancing the dataset revision', async () => {
    const outcome = await createMargin();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    const updated = outcome.value.workspace.datasets[datasetId] as Dataset;

    expect(updated.revision).toBe(dataset.revision);
    expect(updated.columns).toHaveLength(dataset.columns.length + 1);
    expect(projectionKey(updated.columns)).not.toBe(projectionKey(dataset.columns));
  });

  test('the projection key is stable when the column set does not change', () => {
    expect(projectionKey(dataset.columns)).toBe(projectionKey([...dataset.columns]));
  });
});
