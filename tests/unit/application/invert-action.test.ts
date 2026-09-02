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

  /*
   * Extending a selection replaces `workspace.selections` exactly as setting one does, so restoring
   * the prior collection inverts it. Omitting the case would silently mark the action non-undoable.
   */
  test('inverts an extended selection by restoring the prior selections', () => {
    const workspace = workspaceWithDataset();
    const inverse = invertAction(
      {
        type: 'selection.extend',
        payload: {
          datasetId: 'ds_sales',
          mode: 'predicate',
          predicate: { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'West' },
          origin: 'chart',
        },
      },
      workspace,
      ['sel_1'],
    );

    expect(inverse).toEqual({
      type: 'history.restore',
      payload: { state: { selections: workspace.selections }, changedEntityIds: ['sel_1'] },
    });
  });

  /*
   * A link mode is ordinary visualization metadata. Leaving it uninverted made a single chart control
   * change mark the newest history entry non-undoable, which is what blocked undo in practice.
   */
  test('inverts a link-mode change by restoring the prior visualizations', () => {
    const workspace = workspaceWithDataset();
    const inverse = invertAction(
      { type: 'visualization.setLinkMode', payload: { visualizationId: 'viz_1', linkMode: 'filter' } },
      workspace,
      ['viz_1'],
    );

    expect(inverse).toEqual({
      type: 'history.restore',
      payload: { state: { visualizations: workspace.visualizations }, changedEntityIds: ['viz_1'] },
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
