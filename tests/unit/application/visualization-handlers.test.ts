import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleCreateVisualization as rawHandleCreateVisualization,
  handleRemoveVisualization as rawHandleRemoveVisualization,
  handleSetVisualizationLinkMode as rawHandleSetVisualizationLinkMode,
  handleUpdateVisualization as rawHandleUpdateVisualization,
  MAX_VISUALIZATION_TITLE_LENGTH,
} from '@/application/actions/handlers/visualization-handlers.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { VisualBinding } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import { stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const deps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };

type HandlerResult = Result<HandlerOutcome, DomainError>;

// Narrows the handler union to its synchronous result and supplies the default dependencies.
const sync =
  <TPayload>(handler: ActionHandler<TPayload>): ((workspace: Workspace, payload: TPayload) => HandlerResult) =>
  (workspace, payload) =>
    handler(workspace, payload, deps) as HandlerResult;

const createVisualization = sync(rawHandleCreateVisualization);
const updateVisualization = sync(rawHandleUpdateVisualization);
const setVisualizationLinkMode = sync(rawHandleSetVisualizationLinkMode);
const removeVisualization = sync(rawHandleRemoveVisualization);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

const REVENUE_BINDING: VisualBinding = { x: 'col_date', y: ['col_revenue'] };

// A workspace carrying one line chart over the sales dataset, plus that chart's id.
const workspaceWithChart = (): { workspace: Workspace; visualizationId: string } => {
  const created = createVisualization(workspaceWithDataset(), {
    datasetId: 'ds_sales',
    title: '  Revenue  ',
    kind: 'line',
    binding: REVENUE_BINDING,
    presentation: { showGrid: false },
    linkMode: 'filter',
  });

  if (!created.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: created.value.workspace, visualizationId: created.value.changedEntityIds[0]! };
};

describe('handleCreateVisualization', () => {
  test('rejects a title that is blank once trimmed', () => {
    expect(
      failureCode(
        createVisualization(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          title: ' ',
          kind: 'line',
          binding: REVENUE_BINDING,
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(
      failureCode(
        createVisualization(workspaceWithDataset(), {
          datasetId: 'missing',
          title: 'Chart',
          kind: 'line',
          binding: REVENUE_BINDING,
        }),
      ),
    ).toBe('DATASET_NOT_FOUND');
  });

  test('rejects a binding whose column type the chart kind cannot render', () => {
    expect(
      failureCode(
        createVisualization(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          title: 'Chart',
          kind: 'line',
          binding: { x: 'col_notes', y: ['col_revenue'] },
        }),
      ),
    ).toBe('INCOMPATIBLE_COLUMN');
  });

  test('stores the trimmed title and the requested link mode', () => {
    const { workspace, visualizationId } = workspaceWithChart();

    expect(workspace.visualizations[visualizationId]?.title).toBe('Revenue');
    expect(workspace.visualizations[visualizationId]?.linkMode).toBe('filter');
  });

  test('merges supplied presentation options over the defaults', () => {
    const { workspace, visualizationId } = workspaceWithChart();

    expect(workspace.visualizations[visualizationId]?.presentation.showGrid).toBe(false);
    expect(workspace.visualizations[visualizationId]?.presentation.showLegend).toBe(true);
  });

  test('places the new chart on the canvas', () => {
    const { workspace, visualizationId } = workspaceWithChart();

    expect(workspace.layout.items.some((item) => item.visualizationId === visualizationId)).toBe(true);
  });

  test('groups a binned channel as a binned dimension rather than a raw one', () => {
    const created = createVisualization(workspaceWithDataset(), {
      datasetId: 'ds_sales',
      title: 'Binned',
      kind: 'line',
      binding: { x: 'col_date', y: ['col_revenue'], binX: { kind: 'temporal', unit: 'month' }, series: 'col_region' },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const query = created.value.workspace.visualizations[created.value.changedEntityIds[0]!]?.query;

    expect(query?.dimensions).toEqual(['col_region']);
    expect(query?.binnedDimensions).toEqual([{ columnId: 'col_date', strategy: { kind: 'temporal', unit: 'month' } }]);
  });
});

describe('handleUpdateVisualization', () => {
  test('reports VISUALIZATION_NOT_FOUND for an unknown chart', () => {
    expect(failureCode(updateVisualization(workspaceWithDataset(), { visualizationId: 'missing', title: 'x' }))).toBe(
      'VISUALIZATION_NOT_FOUND',
    );
  });

  /*
   * An update re-validates the resulting binding, so a chart cannot be edited into a state the same
   * rules would have refused at creation.
   */
  test('rejects an update whose binding the chart kind does not accept', () => {
    const { workspace, visualizationId } = workspaceWithChart();

    // A line chart needs a temporal or ordered numeric x, which a category column is not.
    expect(
      failureCode(
        updateVisualization(workspace, { visualizationId, binding: { x: 'col_region', y: ['col_revenue'] } }),
      ),
    ).toBe('INCOMPATIBLE_COLUMN');
  });

  test('rejects a title longer than the title budget', () => {
    const { workspace, visualizationId } = workspaceWithChart();

    expect(
      failureCode(
        updateVisualization(workspace, {
          visualizationId,
          title: 'x'.repeat(MAX_VISUALIZATION_TITLE_LENGTH + 1),
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('reports DATASET_NOT_FOUND when the chart points at a dataset that is gone', () => {
    const { workspace, visualizationId } = workspaceWithChart();
    const orphaned: Workspace = {
      ...workspace,
      visualizations: {
        ...workspace.visualizations,
        [visualizationId]: { ...workspace.visualizations[visualizationId]!, datasetId: 'missing' },
      },
    };

    expect(failureCode(updateVisualization(orphaned, { visualizationId }))).toBe('DATASET_NOT_FOUND');
  });

  test('rebuilds the derived query when the binding changes', () => {
    const { workspace, visualizationId } = workspaceWithChart();
    const updated = updateVisualization(workspace, {
      visualizationId,
      title: ' Updated ',
      binding: { x: 'col_date', y: ['col_units'] },
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }

    const chart = updated.value.workspace.visualizations[visualizationId];

    expect(chart?.title).toBe('Updated');
    expect(chart?.query.measures).toEqual([{ columnId: 'col_units', aggregate: 'sum' }]);
  });

  test('keeps an explicitly supplied query and link mode', () => {
    const { workspace, visualizationId } = workspaceWithChart();
    const query: AnalysisQuery = {
      datasetId: 'ds_sales',
      dimensions: [],
      measures: [{ aggregate: 'count' }],
      filters: [],
    };
    const updated = updateVisualization(workspace, { visualizationId, query, linkMode: 'none' });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }

    expect(updated.value.workspace.visualizations[visualizationId]?.query).toEqual(query);
    expect(updated.value.workspace.visualizations[visualizationId]?.linkMode).toBe('none');
  });
});

describe('handleSetVisualizationLinkMode', () => {
  test('reports VISUALIZATION_NOT_FOUND for an unknown chart', () => {
    const { workspace } = workspaceWithChart();

    expect(failureCode(setVisualizationLinkMode(workspace, { visualizationId: 'missing', linkMode: 'none' }))).toBe(
      'VISUALIZATION_NOT_FOUND',
    );
  });

  test('changes the link mode without touching the binding', () => {
    const { workspace, visualizationId } = workspaceWithChart();
    const result = setVisualizationLinkMode(workspace, { visualizationId, linkMode: 'none' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.visualizations[visualizationId]?.linkMode).toBe('none');
    expect(result.value.workspace.visualizations[visualizationId]?.binding).toEqual(REVENUE_BINDING);
  });
});

describe('handleRemoveVisualization', () => {
  test('reports VISUALIZATION_NOT_FOUND for an unknown chart', () => {
    const { workspace } = workspaceWithChart();

    expect(failureCode(removeVisualization(workspace, { visualizationId: 'missing' }))).toBe('VISUALIZATION_NOT_FOUND');
  });

  test('removes the chart, its anchored annotations, and its layout item', () => {
    const { workspace, visualizationId } = workspaceWithChart();
    const annotation: Annotation = {
      id: 'annotation_1',
      visualizationId,
      text: 'note',
      anchor: { kind: 'category', value: 'West' },
      origin: 'human',
      createdBy: 'human',
    };
    const withAnnotation: Workspace = { ...workspace, annotations: { [annotation.id]: annotation } };
    const removed = removeVisualization(withAnnotation, { visualizationId });

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }

    expect(removed.value.workspace.visualizations[visualizationId]).toBeUndefined();
    expect(removed.value.workspace.annotations['annotation_1']).toBeUndefined();
    expect(removed.value.workspace.layout.items.some((item) => item.visualizationId === visualizationId)).toBe(false);
  });
});
