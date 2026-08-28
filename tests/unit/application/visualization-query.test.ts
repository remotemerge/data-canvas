import { describe, expect, test } from 'bun:test';
import { MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import { resolveVisualizationQuery } from '@/application/queries/visualization-query.ts';
import { salesDataset, visualization, workspaceWithDataset } from './action-fixtures.ts';

describe('visualization query resolution', () => {
  test('adds enabled workspace filters and the linked selection predicate', () => {
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
    };
    workspace.selections['selection_region'] = {
      id: 'selection_region',
      datasetId: dataset.id,
      mode: 'predicate',
      predicate: { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'West' },
      origin: 'chart',
    };
    const query = resolveVisualizationQuery(visualization('vis_1', dataset.id), workspace);
    expect(query.filters).toHaveLength(2);
    expect(query.limit).toBe(MAX_CHART_POINTS + 1);
  });
});
