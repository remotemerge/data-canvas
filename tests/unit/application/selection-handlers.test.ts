import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleClearSelection as rawHandleClearSelection,
  handleExtendSelection as rawHandleExtendSelection,
  handleSetSelection as rawHandleSetSelection,
  MAX_SELECTION_KEYS,
} from '@/application/actions/handlers/selection-handlers.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
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

const setSelection = sync(rawHandleSetSelection);
const extendSelection = sync(rawHandleExtendSelection);
const clearSelection = sync(rawHandleClearSelection);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

const WEST: FilterExpression = { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'West' };
const EAST: FilterExpression = { kind: 'comparison', columnId: 'col_region', operator: 'eq', value: 'East' };

// A workspace whose sales dataset carries a two-key selection, plus that selection's id.
const workspaceWithKeySelection = (): { workspace: Workspace; selectionId: string } => {
  const selected = setSelection(workspaceWithDataset(), {
    datasetId: 'ds_sales',
    mode: 'keys',
    keys: ['a', 'b'],
    origin: 'table',
  });

  if (!selected.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: selected.value.workspace, selectionId: selected.value.changedEntityIds[0]! };
};

// A workspace whose sales dataset carries a predicate selection.
const workspaceWithPredicateSelection = (): Workspace => {
  const selected = setSelection(workspaceWithDataset(), {
    datasetId: 'ds_sales',
    mode: 'predicate',
    predicate: WEST,
    origin: 'chart',
  });

  if (!selected.ok) {
    throw new Error('fixture setup failed');
  }

  return selected.value.workspace;
};

describe('handleSetSelection', () => {
  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(
      failureCode(
        setSelection(workspaceWithDataset(), { datasetId: 'missing', mode: 'keys', keys: ['a'], origin: 'table' }),
      ),
    ).toBe('DATASET_NOT_FOUND');
  });

  test('stores the requested keys for the dataset', () => {
    const { workspace, selectionId } = workspaceWithKeySelection();

    expect(workspace.selections[selectionId]?.keys).toEqual(['a', 'b']);
    expect(workspace.selections[selectionId]?.mode).toBe('keys');
  });

  test('rejects a key selection with no keys', () => {
    expect(
      failureCode(
        setSelection(workspaceWithDataset(), { datasetId: 'ds_sales', mode: 'keys', keys: [], origin: 'table' }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects a key selection larger than the key budget', () => {
    expect(
      failureCode(
        setSelection(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          mode: 'keys',
          keys: Array.from({ length: MAX_SELECTION_KEYS + 1 }, String),
          origin: 'table',
        }),
      ),
    ).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('stores a predicate selection for the dataset', () => {
    const workspace = workspaceWithPredicateSelection();
    const selection = Object.values(workspace.selections)[0];

    expect(selection?.mode).toBe('predicate');
    expect(selection?.predicate).toEqual(WEST);
  });

  test('rejects a predicate selection with no predicate', () => {
    expect(
      failureCode(setSelection(workspaceWithDataset(), { datasetId: 'ds_sales', mode: 'predicate', origin: 'chart' })),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('supersedes the existing selection on the same dataset', () => {
    const { workspace, selectionId } = workspaceWithKeySelection();
    const replaced = setSelection(workspace, {
      datasetId: 'ds_sales',
      mode: 'keys',
      keys: ['c'],
      origin: 'table',
    });

    expect(replaced.ok).toBe(true);
    if (!replaced.ok) {
      return;
    }

    expect(replaced.value.workspace.selections[selectionId]).toBeUndefined();
    expect(Object.values(replaced.value.workspace.selections)).toHaveLength(1);
  });
});

describe('handleExtendSelection', () => {
  test('falls back to setting the selection when the dataset has none', () => {
    const extended = extendSelection(workspaceWithDataset(), {
      datasetId: 'ds_sales',
      mode: 'keys',
      keys: ['a'],
      origin: 'chart',
    });

    expect(extended.ok).toBe(true);
    if (!extended.ok) {
      return;
    }

    expect(Object.values(extended.value.workspace.selections)[0]?.keys).toEqual(['a']);
  });

  test('merges new keys into the existing key selection without duplicates', () => {
    const { workspace, selectionId } = workspaceWithKeySelection();
    const extended = extendSelection(workspace, {
      datasetId: 'ds_sales',
      mode: 'keys',
      keys: ['b', 'c'],
      origin: 'chart',
    });

    expect(extended.ok).toBe(true);
    if (!extended.ok) {
      return;
    }

    expect(extended.value.workspace.selections[selectionId]?.keys).toEqual(['a', 'b', 'c']);
  });

  test('rejects extending a key selection with a predicate', () => {
    const { workspace } = workspaceWithKeySelection();

    expect(
      failureCode(
        extendSelection(workspace, { datasetId: 'ds_sales', mode: 'predicate', predicate: WEST, origin: 'chart' }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects extending a key selection with an empty key list', () => {
    const { workspace } = workspaceWithKeySelection();

    expect(
      failureCode(extendSelection(workspace, { datasetId: 'ds_sales', mode: 'keys', keys: [], origin: 'chart' })),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects an extension that would push the selection past the key budget', () => {
    const { workspace, selectionId } = workspaceWithKeySelection();
    const atCapacity: Workspace = {
      ...workspace,
      selections: {
        ...workspace.selections,
        [selectionId]: {
          ...workspace.selections[selectionId]!,
          keys: Array.from({ length: MAX_SELECTION_KEYS }, (_, index) => String(index)),
        },
      },
    };

    expect(
      failureCode(
        extendSelection(atCapacity, { datasetId: 'ds_sales', mode: 'keys', keys: ['overflow'], origin: 'chart' }),
      ),
    ).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('rejects extending a predicate selection with no predicate', () => {
    expect(
      failureCode(
        extendSelection(workspaceWithPredicateSelection(), {
          datasetId: 'ds_sales',
          mode: 'predicate',
          origin: 'chart',
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('combines predicates into a flat or expression', () => {
    const extended = extendSelection(workspaceWithPredicateSelection(), {
      datasetId: 'ds_sales',
      mode: 'predicate',
      predicate: EAST,
      origin: 'agent',
    });

    expect(extended.ok).toBe(true);
    if (!extended.ok) {
      return;
    }

    expect(Object.values(extended.value.workspace.selections)[0]?.predicate).toEqual({
      kind: 'or',
      operands: [WEST, EAST],
    });
  });

  test('flattens a repeated predicate extension instead of nesting or nodes', () => {
    const once = extendSelection(workspaceWithPredicateSelection(), {
      datasetId: 'ds_sales',
      mode: 'predicate',
      predicate: EAST,
      origin: 'agent',
    });

    expect(once.ok).toBe(true);
    if (!once.ok) {
      return;
    }

    const twice = extendSelection(once.value.workspace, {
      datasetId: 'ds_sales',
      mode: 'predicate',
      predicate: WEST,
      origin: 'agent',
    });

    expect(twice.ok).toBe(true);
    if (!twice.ok) {
      return;
    }

    expect(Object.values(twice.value.workspace.selections)[0]?.predicate).toEqual({
      kind: 'or',
      operands: [WEST, EAST, WEST],
    });
  });
});

describe('handleClearSelection', () => {
  test('clears every selection when no dataset is supplied', () => {
    const { workspace } = workspaceWithKeySelection();
    const cleared = clearSelection(workspace, {});

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) {
      return;
    }

    expect(cleared.value.workspace.selections).toEqual({});
  });

  test('clears only the named dataset', () => {
    const { workspace, selectionId } = workspaceWithKeySelection();
    const cleared = clearSelection(workspace, { datasetId: 'ds_sales' });

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) {
      return;
    }

    expect(cleared.value.workspace.selections[selectionId]).toBeUndefined();
  });

  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(failureCode(clearSelection(workspaceWithDataset(), { datasetId: 'missing' }))).toBe('DATASET_NOT_FOUND');
  });
});
