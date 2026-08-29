import { describe, expect, test } from 'bun:test';
import { invertAction } from '@/application/history/invert-action.ts';
import { workspaceWithDataset } from './action-fixtures.ts';

describe('invertAction', () => {
  test('captures the prior filter collection without exposing it in summary text', () => {
    const workspace = workspaceWithDataset();
    const inverse = invertAction(
      { type: 'filter.apply', payload: { datasetId: 'ds_sales', columnId: 'col_revenue', operator: 'gt', value: 10 } },
      workspace,
      ['flt_1'],
    );
    expect(inverse).toEqual({
      type: 'history.restore',
      payload: { state: { filters: workspace.filters }, changedEntityIds: ['flt_1'] },
    });
  });

  test('marks dataset ingestion actions non-invertible', () => {
    expect(
      invertAction(
        { type: 'dataset.import', payload: { datasetId: 'ds_sales', file: {} } },
        workspaceWithDataset(),
        [],
      ),
    ).toBeUndefined();
  });
});
