import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleAddAnnotation as rawHandleAddAnnotation,
  handleRemoveAnnotation as rawHandleRemoveAnnotation,
  MAX_ANNOTATION_TEXT_LENGTH,
} from '@/application/actions/handlers/annotation-handlers.ts';
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

const addAnnotation = sync(rawHandleAddAnnotation);
const removeAnnotation = sync(rawHandleRemoveAnnotation);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

// A workspace with one chart that annotations can anchor to.
const withVisualization = (id = 'viz_1'): Workspace => {
  const workspace = workspaceWithDataset();
  const visualization = makeVisualization(id, 'ds_sales');

  return {
    ...workspace,
    visualizations: { ...workspace.visualizations, [visualization.id]: visualization },
    layout: { ...workspace.layout, items: [{ visualizationId: visualization.id, x: 0, y: 0, width: 6, height: 4 }] },
  };
};

const addNote = (workspace: Workspace, visualizationId: string, text: string): HandlerResult =>
  addAnnotation(workspace, {
    visualizationId,
    text,
    anchor: { kind: 'category', value: 'West' },
    origin: 'human',
  });

describe('handleAddAnnotation', () => {
  test('reports VISUALIZATION_NOT_FOUND for an unknown chart', () => {
    expect(failureCode(addNote(withVisualization(), 'missing', 'note'))).toBe('VISUALIZATION_NOT_FOUND');
  });

  test('rejects annotation text that is blank once trimmed', () => {
    expect(failureCode(addNote(withVisualization(), 'viz_1', '   '))).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects annotation text longer than the text budget', () => {
    expect(failureCode(addNote(withVisualization(), 'viz_1', 'x'.repeat(MAX_ANNOTATION_TEXT_LENGTH + 1)))).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('stores the trimmed text against the chart with the acting author', () => {
    const result = addAnnotation(withVisualization(), {
      visualizationId: 'viz_1',
      text: '  Keep this note  ',
      anchor: { kind: 'point', x: 'West', y: 10 },
      origin: 'human',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const annotation = result.value.workspace.annotations[result.value.changedEntityIds[0]!];

    expect(annotation?.text).toBe('Keep this note');
    expect(annotation?.visualizationId).toBe('viz_1');
    expect(annotation?.createdBy).toBe('human');
  });

  test('keeps annotation text out of the history summary', () => {
    const result = addNote(withVisualization(), 'viz_1', 'sensitive cell value');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.summary).not.toContain('sensitive cell value');
  });
});

describe('handleRemoveAnnotation', () => {
  test('reports UNSUPPORTED_OPERATION for an unknown annotation', () => {
    expect(failureCode(removeAnnotation(withVisualization(), { annotationId: 'missing' }))).toBe(
      'UNSUPPORTED_OPERATION',
    );
  });

  test('drops the annotation from the workspace', () => {
    const added = addNote(withVisualization(), 'viz_1', 'note');

    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }

    const annotationId = added.value.changedEntityIds[0]!;
    const removed = removeAnnotation(added.value.workspace, { annotationId });

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }

    expect(removed.value.workspace.annotations[annotationId]).toBeUndefined();
  });
});
