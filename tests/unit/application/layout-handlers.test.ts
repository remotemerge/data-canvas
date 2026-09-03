import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleUpdateLayout as rawHandleUpdateLayout,
  MAX_LAYOUT_COLUMNS,
  MAX_LAYOUT_ITEMS,
  MIN_LAYOUT_COLUMNS,
} from '@/application/actions/handlers/layout-handlers.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import { stubDataEngine, visualization as makeVisualization, workspaceWithDataset } from './action-fixtures.ts';

const deps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };

type HandlerResult = Result<HandlerOutcome, DomainError>;

// Narrows the handler union to its synchronous result and supplies the default dependencies.
const sync =
  <TPayload>(handler: ActionHandler<TPayload>): ((workspace: Workspace, payload: TPayload) => HandlerResult) =>
  (workspace, payload) =>
    handler(workspace, payload, deps) as HandlerResult;

const updateLayout = sync(rawHandleUpdateLayout);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

// A workspace with one chart placed on the canvas.
const withVisualization = (id = 'viz_1'): Workspace => {
  const workspace = workspaceWithDataset();
  const visualization = makeVisualization(id, 'ds_sales');

  return {
    ...workspace,
    visualizations: { ...workspace.visualizations, [visualization.id]: visualization },
    layout: { ...workspace.layout, items: [{ visualizationId: visualization.id, x: 0, y: 0, width: 6, height: 4 }] },
  };
};

describe('handleUpdateLayout', () => {
  test('rejects a column count below the supported range', () => {
    expect(failureCode(updateLayout(withVisualization(), { columns: MIN_LAYOUT_COLUMNS - 1 }))).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('rejects a column count above the supported range', () => {
    expect(failureCode(updateLayout(withVisualization(), { columns: MAX_LAYOUT_COLUMNS + 1 }))).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('rejects more layout items than the canvas holds', () => {
    const items = Array.from({ length: MAX_LAYOUT_ITEMS + 1 }, () => ({
      visualizationId: 'viz_1',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));

    expect(failureCode(updateLayout(withVisualization(), { items }))).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('rejects a slot reserved for a visualization that does not exist', () => {
    expect(
      failureCode(
        updateLayout(withVisualization(), { items: [{ visualizationId: 'missing', x: 0, y: 0, width: 1, height: 1 }] }),
      ),
    ).toBe('VISUALIZATION_NOT_FOUND');
  });

  test('rejects an item that overflows the requested column count', () => {
    expect(
      failureCode(
        updateLayout(withVisualization(), {
          columns: 3,
          items: [{ visualizationId: 'viz_1', x: 3, y: 0, width: 1, height: 1 }],
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('commits columns and items that fit together', () => {
    const items = [{ visualizationId: 'viz_1', x: 0, y: 0, width: 2, height: 1 }];
    const result = updateLayout(withVisualization(), { columns: 3, items });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.layout.columns).toBe(3);
    expect(result.value.workspace.layout.items).toEqual(items);
    expect(result.value.summary).toContain('3 columns');
  });

  /*
   * A density change used to alter only the column count, leaving items measured against the old
   * grid. A chart at `x: 6` on a 12-column canvas then hung off a 6-column one and rendered as a
   * sliver at the edge.
   */
  test('narrowing the canvas refits existing items instead of overflowing them', () => {
    const workspace = withVisualization();
    const paired = {
      ...workspace,
      layout: {
        columns: 12,
        items: [
          { visualizationId: 'viz_1', x: 0, y: 0, width: 6, height: 4 },
          { visualizationId: 'viz_1', x: 6, y: 0, width: 6, height: 4 },
        ],
      },
    };
    const result = updateLayout(paired, { columns: 6 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Comfortable gives each chart its own row, so the pair stacks at full width.
    expect(result.value.workspace.layout.items).toEqual([
      { visualizationId: 'viz_1', x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: 'viz_1', x: 0, y: 4, width: 6, height: 4 },
    ]);
    // Every item stays inside the narrower grid.
    for (const item of result.value.workspace.layout.items) {
      expect(item.x + item.width).toBeLessThanOrEqual(6);
    }
  });

  test('the compact canvas fits three charts to a row', () => {
    const workspace = withVisualization();
    const three = {
      ...workspace,
      layout: {
        columns: 12,
        items: [
          { visualizationId: 'viz_1', x: 0, y: 0, width: 6, height: 4 },
          { visualizationId: 'viz_1', x: 6, y: 0, width: 6, height: 4 },
          { visualizationId: 'viz_1', x: 0, y: 4, width: 6, height: 4 },
        ],
      },
    };
    const result = updateLayout(three, { columns: 18 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.layout.items.map((item) => [item.x, item.y, item.width])).toEqual([
      [0, 0, 6],
      [6, 0, 6],
      [12, 0, 6],
    ]);
  });

  test('keeps the current column count when only items are repositioned', () => {
    const workspace = withVisualization();
    const result = updateLayout(workspace, { items: workspace.layout.items });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.layout.columns).toBe(workspace.layout.columns);
    expect(result.value.summary).toContain('Repositioned');
  });
});
