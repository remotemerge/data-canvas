import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import { handleSetTableSort as rawHandleSetTableSort } from '@/application/actions/handlers/table-handlers.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import { SALES_COLUMNS, stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const deps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };

type HandlerResult = Result<HandlerOutcome, DomainError>;

// Narrows the handler union to its synchronous result and supplies the default dependencies.
const sync =
  <TPayload>(handler: ActionHandler<TPayload>): ((workspace: Workspace, payload: TPayload) => HandlerResult) =>
  (workspace, payload) =>
    handler(workspace, payload, deps) as HandlerResult;

const setTableSort = sync(rawHandleSetTableSort);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

describe('handleSetTableSort', () => {
  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(failureCode(setTableSort(workspaceWithDataset(), { datasetId: 'missing', sort: [] }))).toBe(
      'DATASET_NOT_FOUND',
    );
  });

  test('rejects more than ten sort columns', () => {
    const sort = Array.from({ length: 11 }, (_, index) => ({
      columnId: SALES_COLUMNS[index % SALES_COLUMNS.length]!.id,
      direction: 'asc' as const,
    }));

    expect(failureCode(setTableSort(workspaceWithDataset(), { datasetId: 'ds_sales', sort }))).toBe(
      'RESULT_LIMIT_EXCEEDED',
    );
  });

  test('reports COLUMN_NOT_FOUND when a sort names a column the dataset lacks', () => {
    expect(
      failureCode(
        setTableSort(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          sort: [{ columnId: 'missing', direction: 'asc' }],
        }),
      ),
    ).toBe('COLUMN_NOT_FOUND');
  });

  test('stores a sort over an existing column', () => {
    const sort = [{ columnId: 'col_revenue', direction: 'desc' as const }];
    const result = setTableSort(workspaceWithDataset(), { datasetId: 'ds_sales', sort });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.tableSorts['ds_sales']).toEqual(sort);
  });

  test('clears the sort for a dataset when the sort list is empty', () => {
    const result = setTableSort(workspaceWithDataset(), { datasetId: 'ds_sales', sort: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.tableSorts['ds_sales']).toEqual([]);
  });
});
