import { describe, expect, test } from 'bun:test';
import { remapWorkspaceIds } from '@/data/portability/remap-entity-ids.ts';
import { createEmptyWorkspace, type Workspace } from '@/domain/workspace/workspace.ts';

/**
 * A workspace whose entities all use archive-supplied IDs, including one shaped to collide with a
 * plausible existing entity. Built literally rather than through the dispatcher so the test states
 * exactly which references must survive the remap.
 */
const archivedWorkspace = (): Workspace => {
  const base = createEmptyWorkspace('Imported');

  return {
    ...base,
    id: 'ws_archive',
    activeDatasetId: 'ds_orders',
    datasets: {
      ds_orders: {
        id: 'ds_orders',
        name: 'Orders',
        relationId: 'dataset_deadbeef0001',
        source: { kind: 'csv', fileName: 'orders.csv', byteSize: 10, importedAt: '2026-01-01T00:00:00.000Z' },
        rowCount: 5,
        columns: [
          {
            id: 'col_region',
            name: 'region',
            physicalName: 'c0',
            databaseType: 'VARCHAR',
            logicalType: 'string',
            nullable: true,
          },
          {
            id: 'col_amount',
            name: 'amount',
            physicalName: 'c1',
            databaseType: 'DOUBLE',
            logicalType: 'number',
            nullable: true,
          },
        ],
        revision: 1,
        importStatus: 'ready',
      },
      ds_customers: {
        id: 'ds_customers',
        name: 'Customers',
        relationId: 'dataset_deadbeef0002',
        source: { kind: 'csv', fileName: 'customers.csv', byteSize: 10, importedAt: '2026-01-01T00:00:00.000Z' },
        rowCount: 3,
        columns: [
          {
            id: 'col_customer_region',
            name: 'region',
            physicalName: 'c0',
            databaseType: 'VARCHAR',
            logicalType: 'string',
            nullable: true,
          },
        ],
        revision: 1,
        importStatus: 'ready',
      },
    },
    derivedColumns: {
      col_double: {
        id: 'col_double',
        datasetId: 'ds_orders',
        name: 'Double amount',
        expression: {
          kind: 'arithmetic',
          op: 'mul',
          left: { kind: 'column', columnId: 'col_amount' },
          right: { kind: 'literal', value: 2 },
        },
        logicalType: 'number',
        typeVerified: true,
        createdBy: 'human',
      },
    },
    relationships: {
      rel_link: {
        id: 'rel_link',
        leftDatasetId: 'ds_orders',
        rightDatasetId: 'ds_customers',
        on: [{ leftColumnId: 'col_region', rightColumnId: 'col_customer_region' }],
        kind: 'many_to_one',
        join: 'inner',
        createdBy: 'human',
      },
    },
    visualizations: {
      viz_sales: {
        id: 'viz_sales',
        datasetId: 'ds_orders',
        title: 'Sales',
        kind: 'bar',
        query: {
          datasetId: 'ds_orders',
          relationshipIds: ['rel_link'],
          dimensions: ['col_region'],
          measures: [{ columnId: 'col_amount', aggregate: 'sum' }],
          filters: [{ kind: 'comparison', columnId: 'col_amount', operator: 'gt', value: 0 }],
          orderBy: [{ columnId: 'col_region', direction: 'asc' }],
        },
        binding: { x: 'col_region', y: ['col_amount', 'col_double'] },
        presentation: { showLegend: true, showGrid: true, stacked: false },
        linkMode: 'highlight',
        createdBy: 'human',
      },
    },
    filters: {
      flt_region: {
        id: 'flt_region',
        datasetId: 'ds_orders',
        columnId: 'col_region',
        operator: 'eq',
        value: 'EU',
        enabled: true,
        origin: 'human',
        createdBy: 'human',
      },
    },
    tableSorts: { ds_orders: [{ columnId: 'col_amount', direction: 'desc' }] },
    selections: {
      sel_eu: {
        id: 'sel_eu',
        datasetId: 'ds_orders',
        mode: 'predicate',
        predicate: {
          kind: 'and',
          operands: [
            { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'EU' },
            { kind: 'not', operand: { kind: 'comparison', columnId: 'col_amount', operator: 'lt', value: 10 } },
          ],
        },
        origin: 'chart',
      },
    },
    metrics: {
      mtr_total: {
        id: 'mtr_total',
        datasetId: 'ds_orders',
        name: 'Total',
        aggregate: 'sum',
        columnId: 'col_amount',
        filters: ['flt_region'],
        createdBy: 'human',
      },
    },
    annotations: {
      ann_note: {
        id: 'ann_note',
        visualizationId: 'viz_sales',
        text: 'Peak',
        anchor: { kind: 'data', dimension: 'col_region', value: 'EU' },
        origin: 'human',
        createdBy: 'human',
      },
    },
    layout: { columns: 12, items: [{ visualizationId: 'viz_sales', x: 0, y: 0, width: 6, height: 4 }] },
  };
};

describe('entity ID remapping', () => {
  test('regenerates every ID so none from the archive survives', () => {
    const { workspace, danglingReferences } = remapWorkspaceIds(archivedWorkspace());
    expect(danglingReferences).toEqual([]);

    const archivedIds = [
      'ws_archive',
      'ds_orders',
      'ds_customers',
      'col_region',
      'col_amount',
      'col_customer_region',
      'col_double',
      'rel_link',
      'viz_sales',
      'flt_region',
      'sel_eu',
      'mtr_total',
      'ann_note',
    ];
    const serialized = JSON.stringify(workspace);
    for (const id of archivedIds) expect(serialized).not.toContain(`"${id}"`);
    expect(workspace.id).not.toBe('ws_archive');
  });

  test('remaps every cross-reference consistently', () => {
    const { workspace } = remapWorkspaceIds(archivedWorkspace());
    const dataset = Object.values(workspace.datasets).find((entry) => entry.name === 'Orders')!;
    const customers = Object.values(workspace.datasets).find((entry) => entry.name === 'Customers')!;
    const regionId = dataset.columns[0]!.id;
    const amountId = dataset.columns[1]!.id;
    const visualization = Object.values(workspace.visualizations)[0]!;
    const relationship = Object.values(workspace.relationships)[0]!;
    const filter = Object.values(workspace.filters)[0]!;
    const metric = Object.values(workspace.metrics)[0]!;
    const annotation = Object.values(workspace.annotations)[0]!;
    const derived = Object.values(workspace.derivedColumns)[0]!;

    expect(visualization.datasetId).toBe(dataset.id);
    expect(visualization.binding.x).toBe(regionId);
    expect(visualization.binding.y).toEqual([amountId, derived.id]);
    expect(visualization.query.dimensions).toEqual([regionId]);
    expect(visualization.query.measures[0]!.columnId).toBe(amountId);
    expect(visualization.query.relationshipIds).toEqual([relationship.id]);
    expect(visualization.query.orderBy?.[0]?.columnId).toBe(regionId);

    expect(relationship.leftDatasetId).toBe(dataset.id);
    expect(relationship.rightDatasetId).toBe(customers.id);
    expect(relationship.on[0]!.leftColumnId).toBe(regionId);
    expect(relationship.on[0]!.rightColumnId).toBe(customers.columns[0]!.id);

    expect(filter.columnId).toBe(regionId);
    expect(metric.filters).toEqual([filter.id]);
    expect(metric.columnId).toBe(amountId);
    expect(annotation.visualizationId).toBe(visualization.id);
    expect(workspace.layout.items[0]!.visualizationId).toBe(visualization.id);
    expect(workspace.activeDatasetId).toBe(dataset.id);
    expect(Object.keys(workspace.tableSorts)).toEqual([dataset.id]);
  });

  test('rewrites column references nested inside expression trees', () => {
    const { workspace } = remapWorkspaceIds(archivedWorkspace());
    const dataset = Object.values(workspace.datasets).find((entry) => entry.name === 'Orders')!;
    const amountId = dataset.columns[1]!.id;
    const regionId = dataset.columns[0]!.id;
    const derived = Object.values(workspace.derivedColumns)[0]!;
    const selection = Object.values(workspace.selections)[0]!;

    expect(derived.expression).toEqual({
      kind: 'arithmetic',
      op: 'mul',
      left: { kind: 'column', columnId: amountId },
      right: { kind: 'literal', value: 2 },
    });
    expect(selection.predicate).toEqual({
      kind: 'and',
      operands: [
        { kind: 'comparison', columnId: regionId, operator: 'eq', value: 'EU' },
        { kind: 'not', operand: { kind: 'comparison', columnId: amountId, operator: 'lt', value: 10 } },
      ],
    });
  });

  test('keys every entity map by its new ID', () => {
    const { workspace } = remapWorkspaceIds(archivedWorkspace());
    for (const [id, dataset] of Object.entries(workspace.datasets)) expect(dataset.id).toBe(id);
    for (const [id, viz] of Object.entries(workspace.visualizations)) expect(viz.id).toBe(id);
    for (const [id, filter] of Object.entries(workspace.filters)) expect(filter.id).toBe(id);
  });

  test('reports a reference the archive never defined instead of silently keeping it', () => {
    const archive = archivedWorkspace();
    archive.visualizations['viz_sales']!.binding.x = 'col_absent';
    const { danglingReferences } = remapWorkspaceIds(archive);
    expect(danglingReferences).toContain('visualization.binding.x');
  });

  test('produces distinct IDs across two imports of the same archive', () => {
    const first = remapWorkspaceIds(archivedWorkspace()).workspace;
    const second = remapWorkspaceIds(archivedWorkspace()).workspace;
    expect(first.id).not.toBe(second.id);
    expect(Object.keys(first.visualizations)).not.toEqual(Object.keys(second.visualizations));
  });
});
