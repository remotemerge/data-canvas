import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleCreateDerivedColumn as rawHandleCreateDerivedColumn,
  handleRemoveDerivedColumn as rawHandleRemoveDerivedColumn,
} from '@/application/actions/handlers/derived-column-handlers.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import { isDerivedColumnId } from '@/domain/dataset/derived-column.ts';
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

const createDerivedColumn = sync(rawHandleCreateDerivedColumn);
const removeDerivedColumn = sync(rawHandleRemoveDerivedColumn);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

const REVENUE_PLUS_ONE: DerivedExpression = {
  kind: 'arithmetic',
  op: 'add',
  left: { kind: 'column', columnId: 'col_revenue' },
  right: { kind: 'literal', value: 1 },
};

// A workspace carrying one derived column on the sales dataset, plus that column's id.
const workspaceWithDerivedColumn = (): { workspace: Workspace; derivedId: string } => {
  const created = createDerivedColumn(workspaceWithDataset(), {
    datasetId: 'ds_sales',
    name: 'Revenue plus one',
    expression: REVENUE_PLUS_ONE,
  });

  if (!created.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: created.value.workspace, derivedId: created.value.changedEntityIds[0]! };
};

describe('handleCreateDerivedColumn', () => {
  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(
      failureCode(
        createDerivedColumn(workspaceWithDataset(), {
          datasetId: 'missing',
          name: 'x',
          expression: REVENUE_PLUS_ONE,
        }),
      ),
    ).toBe('DATASET_NOT_FOUND');
  });

  test('rejects a name that is blank once trimmed', () => {
    expect(
      failureCode(
        createDerivedColumn(workspaceWithDataset(), {
          datasetId: 'ds_sales',
          name: ' ',
          expression: REVENUE_PLUS_ONE,
        }),
      ),
    ).toBe('UNSUPPORTED_OPERATION');
  });

  test('registers the definition under a derived column identifier', () => {
    const { workspace, derivedId } = workspaceWithDerivedColumn();

    expect(isDerivedColumnId(derivedId, workspace.derivedColumns)).toBe(true);
    expect(workspace.derivedColumns[derivedId]?.logicalType).toBe('number');
    expect(workspace.derivedColumns[derivedId]?.typeVerified).toBe(false);
  });

  test('exposes the derived column on the dataset so queries can bind to it', () => {
    const { workspace, derivedId } = workspaceWithDerivedColumn();

    expect(workspace.datasets['ds_sales']?.columns.some((column) => column.id === derivedId)).toBe(true);
  });
});

describe('handleRemoveDerivedColumn', () => {
  test('reports COLUMN_NOT_FOUND for an unknown derived column', () => {
    expect(failureCode(removeDerivedColumn(workspaceWithDataset(), { derivedColumnId: 'missing' }))).toBe(
      'COLUMN_NOT_FOUND',
    );
  });

  test('refuses to remove a derived column another derived column depends on', () => {
    const { workspace, derivedId } = workspaceWithDerivedColumn();
    const dependentWorkspace: Workspace = {
      ...workspace,
      derivedColumns: {
        ...workspace.derivedColumns,
        derived_dependent: {
          id: 'derived_dependent',
          datasetId: 'ds_sales',
          name: 'Dependent',
          expression: { kind: 'column', columnId: derivedId },
          logicalType: 'number',
          typeVerified: false,
          createdBy: 'human',
        },
      },
    };

    expect(failureCode(removeDerivedColumn(dependentWorkspace, { derivedColumnId: derivedId }))).toBe('DATASET_IN_USE');
  });

  test('refuses to remove a derived column a visualization is bound to', () => {
    const { workspace, derivedId } = workspaceWithDerivedColumn();
    const chartBoundWorkspace: Workspace = {
      ...workspace,
      visualizations: {
        viz_derived: {
          ...makeVisualization('viz_derived', 'ds_sales'),
          binding: { x: 'col_date', y: [derivedId] },
          query: {
            datasetId: 'ds_sales',
            dimensions: ['col_date'],
            measures: [{ columnId: derivedId, aggregate: 'sum' }],
            filters: [],
          },
        },
      },
    };

    expect(failureCode(removeDerivedColumn(chartBoundWorkspace, { derivedColumnId: derivedId }))).toBe(
      'DATASET_IN_USE',
    );
  });

  test('drops the definition and the dataset column when nothing references it', () => {
    const { workspace, derivedId } = workspaceWithDerivedColumn();
    const removed = removeDerivedColumn(workspace, { derivedColumnId: derivedId });

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }

    expect(removed.value.workspace.derivedColumns[derivedId]).toBeUndefined();
    expect(removed.value.workspace.datasets['ds_sales']?.columns.some((column) => column.id === derivedId)).toBe(false);
  });
});
