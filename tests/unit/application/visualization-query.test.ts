import { describe, expect, test } from 'bun:test';
import { MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import { resolveVisualizationQuery } from '@/application/queries/visualization-query.ts';
import { salesDataset, visualization, workspaceWithDataset } from './action-fixtures.ts';

/** A workspace with one enabled filter and one predicate selection, both on the sales dataset. */
const workspaceWithFilterAndSelection = () => {
  const dataset = salesDataset();
  const workspace = workspaceWithDataset();
  workspace.filters['filter_region'] = {
    id: 'filter_region',
    datasetId: dataset.id,
    columnId: 'col_region',
    operator: 'eq',
    value: 'West',
    enabled: true,
    origin: 'human',
    createdBy: 'human',
  };
  workspace.selections['selection_region'] = {
    id: 'selection_region',
    datasetId: dataset.id,
    mode: 'predicate',
    predicate: { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'West' },
    origin: 'chart',
  };

  return { dataset, workspace };
};

describe('visualization query resolution', () => {
  test('adds enabled workspace filters', () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const query = resolveVisualizationQuery(visualization('vis_1', dataset.id), workspace);
    expect(query.limit).toBe(MAX_CHART_POINTS + 1);
    // The workspace filter only. `highlight` is the default and does not restrict the query.
    expect(query.filters).toHaveLength(1);
  });

  test("'filter' link mode applies the selection to the query", () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = { ...visualization('vis_1', dataset.id), linkMode: 'filter' as const };
    const query = resolveVisualizationQuery(chart, workspace);
    expect(query.filters).toHaveLength(2);
  });

  test("'highlight' link mode leaves the query unrestricted", () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = { ...visualization('vis_1', dataset.id), linkMode: 'highlight' as const };
    expect(resolveVisualizationQuery(chart, workspace).filters).toHaveLength(1);
  });

  test("'none' link mode ignores the selection entirely", () => {
    const { dataset, workspace } = workspaceWithFilterAndSelection();
    const chart = { ...visualization('vis_1', dataset.id), linkMode: 'none' as const };
    expect(resolveVisualizationQuery(chart, workspace).filters).toHaveLength(1);
  });
});
