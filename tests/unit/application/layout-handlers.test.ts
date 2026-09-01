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
