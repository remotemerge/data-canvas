import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleApplyFilter as rawHandleApplyFilter,
  handleClearFilters as rawHandleClearFilters,
  handleRemoveFilter as rawHandleRemoveFilter,
} from '@/application/actions/handlers/filter-handlers.ts';
import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import { stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const deps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };
const agentDeps: HandlerDeps = { actor: 'agent', dataEngine: unavailableDataEngine };

type HandlerResult = Result<HandlerOutcome, DomainError>;

// Narrows the handler union to its synchronous result.
const sync =
  <TPayload>(
    handler: ActionHandler<TPayload>,
  ): ((workspace: Workspace, payload: TPayload, handlerDeps?: HandlerDeps) => HandlerResult) =>
  (workspace, payload, handlerDeps = deps) =>
    handler(workspace, payload, handlerDeps) as HandlerResult;

const applyFilter = sync(rawHandleApplyFilter);
const clearFilters = sync(rawHandleClearFilters);
const removeFilter = sync(rawHandleRemoveFilter);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

// A workspace holding one enabled region filter on the sales dataset, plus that filter's id.
const workspaceWithFilter = (): { workspace: Workspace; filterId: string } => {
  const applied = applyFilter(workspaceWithDataset(), {
    datasetId: 'ds_sales',
    columnId: 'col_region',
    operator: 'eq',
    value: 'West',
  });

  if (!applied.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: applied.value.workspace, filterId: applied.value.changedEntityIds[0]! };
};

const FILTER_ON_OTHER_DATASET: Filter = {
  id: 'filter_other',
  datasetId: 'ds_other',
  columnId: 'col_region',
  operator: 'eq',
  value: 'North',
  enabled: true,
  origin: 'human',
  createdBy: 'human',
};

describe('handleApplyFilter', () => {
  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(
      failureCode(
        applyFilter(workspaceWithDataset(), {
          datasetId: 'missing',
          columnId: 'col_region',
          operator: 'eq',
          value: 'West',
        }),
      ),
    ).toBe('DATASET_NOT_FOUND');
  });

  test('stores a new enabled filter for the requested column', () => {
    const { workspace, filterId } = workspaceWithFilter();
    const filter = workspace.filters[filterId];

    expect(filter?.datasetId).toBe('ds_sales');
    expect(filter?.columnId).toBe('col_region');
    expect(filter?.value).toBe('West');
    expect(filter?.enabled).toBe(true);
  });

  test('replaces a filter with the same column and operator rather than adding a second one', () => {
    const { workspace, filterId } = workspaceWithFilter();
    const updated = applyFilter(workspace, {
      datasetId: 'ds_sales',
      columnId: 'col_region',
      operator: 'eq',
      value: 'East',
      enabled: false,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }

    expect(Object.keys(updated.value.workspace.filters)).toEqual([filterId]);
    expect(updated.value.workspace.filters[filterId]?.value).toBe('East');
    expect(updated.value.workspace.filters[filterId]?.enabled).toBe(false);
  });

  test('keeps the original author when an agent updates a human filter', () => {
    const { workspace, filterId } = workspaceWithFilter();
    const updated = applyFilter(
      workspace,
      { datasetId: 'ds_sales', columnId: 'col_region', operator: 'eq', value: 'East' },
      agentDeps,
    );

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }

    expect(updated.value.workspace.filters[filterId]?.createdBy).toBe('human');
    expect(updated.value.workspace.filters[filterId]?.origin).toBe('agent');
  });
});

describe('handleRemoveFilter', () => {
  test('reports FILTER_NOT_FOUND for an unknown filter', () => {
    const { workspace } = workspaceWithFilter();

    expect(failureCode(removeFilter(workspace, { filterId: 'missing' }))).toBe('FILTER_NOT_FOUND');
  });

  test('drops the requested filter', () => {
    const { workspace, filterId } = workspaceWithFilter();
    const removed = removeFilter(workspace, { filterId });

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }

    expect(removed.value.workspace.filters[filterId]).toBeUndefined();
  });
});

describe('handleClearFilters', () => {
  test('clears every filter when no dataset is supplied', () => {
    const { workspace } = workspaceWithFilter();
    const cleared = clearFilters(
      { ...workspace, filters: { ...workspace.filters, [FILTER_ON_OTHER_DATASET.id]: FILTER_ON_OTHER_DATASET } },
      {},
    );

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) {
      return;
    }

    expect(cleared.value.workspace.filters).toEqual({});
  });

  test('clears only the named dataset and leaves other datasets filtered', () => {
    const { workspace, filterId } = workspaceWithFilter();
    const cleared = clearFilters(
      { ...workspace, filters: { ...workspace.filters, [FILTER_ON_OTHER_DATASET.id]: FILTER_ON_OTHER_DATASET } },
      { datasetId: 'ds_sales' },
    );

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) {
      return;
    }

    expect(cleared.value.workspace.filters[filterId]).toBeUndefined();
    expect(cleared.value.workspace.filters[FILTER_ON_OTHER_DATASET.id]).toBeDefined();
  });

  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    const { workspace } = workspaceWithFilter();

    expect(failureCode(clearFilters(workspace, { datasetId: 'missing' }))).toBe('DATASET_NOT_FOUND');
  });
});
