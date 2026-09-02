import { describe, expect, test } from 'bun:test';
import type { ActionHandler, HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import {
  handleBeginDatasetImport as rawHandleBeginDatasetImport,
  handleFailDatasetImport as rawHandleFailDatasetImport,
  handleImportDataset,
  handleSetActiveDataset as rawHandleSetActiveDataset,
  MAX_DATASET_NAME_LENGTH,
} from '@/application/actions/handlers/dataset-handlers.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';
import { salesDataset, stubDataEngine, workspaceWithDataset } from './action-fixtures.ts';

const deps: HandlerDeps = { actor: 'human', dataEngine: stubDataEngine() };

type HandlerResult = Result<HandlerOutcome, DomainError>;

// Narrows the handler union to its synchronous result and supplies the default dependencies.
const sync =
  <TPayload>(handler: ActionHandler<TPayload>): ((workspace: Workspace, payload: TPayload) => HandlerResult) =>
  (workspace, payload) =>
    handler(workspace, payload, deps) as HandlerResult;

const beginDatasetImport = sync(rawHandleBeginDatasetImport);
const failDatasetImport = sync(rawHandleFailDatasetImport);
const setActiveDataset = sync(rawHandleSetActiveDataset);

const failureCode = (result: Result<unknown, DomainError>): string => {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error.code;
};

const beginImport = (workspace: Workspace, name: string, byteSize = 100): HandlerResult =>
  beginDatasetImport(workspace, { name, sourceKind: 'csv', byteSize });

// A workspace holding a single loading dataset, plus that dataset's id.
const loadingWorkspace = (): { workspace: Workspace; datasetId: string } => {
  const started = beginImport(createEmptyWorkspace('Imports'), 'New data');

  if (!started.ok) {
    throw new Error('fixture setup failed');
  }

  return { workspace: started.value.workspace, datasetId: started.value.changedEntityIds[0]! };
};

describe('handleBeginDatasetImport', () => {
  test('rejects an import whose name is only whitespace', () => {
    expect(failureCode(beginImport(createEmptyWorkspace(), ' ', 1))).toBe('IMPORT_FAILED');
  });

  test('rejects an import whose name exceeds the name budget', () => {
    const result = beginDatasetImport(createEmptyWorkspace(), {
      name: 'x'.repeat(MAX_DATASET_NAME_LENGTH + 1),
      sourceKind: 'json',
      byteSize: 1,
    });

    expect(failureCode(result)).toBe('IMPORT_FAILED');
  });

  test('deduplicates a repeated dataset name by appending the next free counter', () => {
    const workspace = workspaceWithDataset();
    const duplicate = { ...salesDataset('ds_sales_2'), name: 'Sales (2)' };
    workspace.datasets[duplicate.id] = duplicate;

    const started = beginImport(workspace, ' Sales ');

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(started.value.workspace.datasets[started.value.changedEntityIds[0]!]?.name).toBe('Sales (3)');
  });

  test('records the trimmed request as the source file name for provenance', () => {
    const started = beginImport(workspaceWithDataset(), ' Sales ');

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(started.value.workspace.datasets[started.value.changedEntityIds[0]!]?.source.fileName).toBe('Sales');
  });

  test('clamps a negative fractional byte size to zero', () => {
    const started = beginImport(workspaceWithDataset(), 'Sales', -4.7);

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(started.value.workspace.datasets[started.value.changedEntityIds[0]!]?.source.byteSize).toBe(0);
  });

  test('marks the new dataset as loading', () => {
    const { workspace, datasetId } = loadingWorkspace();

    expect(workspace.datasets[datasetId]?.importStatus).toBe('loading');
  });
});

describe('handleImportDataset', () => {
  test('reports DATASET_NOT_FOUND for an unknown dataset', async () => {
    const { workspace } = loadingWorkspace();

    expect(failureCode(await handleImportDataset(workspace, { datasetId: 'missing', file: {} }, deps))).toBe(
      'DATASET_NOT_FOUND',
    );
  });

  test('rejects an import with no file', async () => {
    const { workspace, datasetId } = loadingWorkspace();

    expect(failureCode(await handleImportDataset(workspace, { datasetId, file: null }, deps))).toBe('IMPORT_FAILED');
  });

  test('propagates an engine import failure', async () => {
    const { workspace, datasetId } = loadingWorkspace();
    const failingEngine = stubDataEngine(() => Promise.resolve(err(domainError('IMPORT_FAILED', 'bad file'))));

    expect(
      failureCode(
        await handleImportDataset(workspace, { datasetId, file: {} }, { ...deps, dataEngine: failingEngine }),
      ),
    ).toBe('IMPORT_FAILED');
  });

  test('marks the dataset ready once the engine returns its relation', async () => {
    const { workspace, datasetId } = loadingWorkspace();
    const imported = await handleImportDataset(workspace, { datasetId, file: {} }, deps);

    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }

    expect(imported.value.workspace.datasets[datasetId]?.importStatus).toBe('ready');
    expect(imported.value.workspace.datasets[datasetId]?.rowCount).toBe(42);
    expect(imported.value.workspace.datasets[datasetId]?.revision).toBe(1);
  });

  test('rejects re-importing a dataset that already finished', async () => {
    const { workspace, datasetId } = loadingWorkspace();
    const imported = await handleImportDataset(workspace, { datasetId, file: {} }, deps);

    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }

    expect(failureCode(await handleImportDataset(imported.value.workspace, { datasetId, file: {} }, deps))).toBe(
      'IMPORT_FAILED',
    );
  });
});

describe('handleFailDatasetImport', () => {
  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    const { workspace } = loadingWorkspace();

    expect(failureCode(failDatasetImport(workspace, { datasetId: 'missing', reason: 'bad' }))).toBe(
      'DATASET_NOT_FOUND',
    );
  });

  test('clears the active dataset when the failed import was the active one', () => {
    const { workspace, datasetId } = loadingWorkspace();
    const failed = failDatasetImport(workspace, { datasetId, reason: 'parse error' });

    expect(failed.ok).toBe(true);
    if (!failed.ok) {
      return;
    }

    expect(failed.value.workspace.activeDatasetId).toBeUndefined();
    expect(failed.value.workspace.datasets[datasetId]?.importStatus).toBe('error');
  });

  test('keeps the failure reason verbatim in the summary', () => {
    const { workspace, datasetId } = loadingWorkspace();
    const failed = failDatasetImport(workspace, { datasetId, reason: '<unsafe>' });

    expect(failed.ok).toBe(true);
    if (!failed.ok) {
      return;
    }

    expect(failed.value.summary).toContain('<unsafe>');
  });

  test('leaves a different active dataset untouched', () => {
    const { workspace, datasetId } = loadingWorkspace();
    const failed = failDatasetImport(
      { ...workspace, activeDatasetId: 'another' },
      { datasetId, reason: 'parse error' },
    );

    expect(failed.ok).toBe(true);
    if (!failed.ok) {
      return;
    }

    expect(failed.value.workspace.activeDatasetId).toBe('another');
  });
});

describe('handleSetActiveDataset', () => {
  test('clears the active dataset when no id is supplied', () => {
    const result = setActiveDataset(workspaceWithDataset(), {});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.activeDatasetId).toBeUndefined();
    expect(result.value.changedEntityIds).toEqual([]);
  });

  test('reports DATASET_NOT_FOUND for an unknown dataset', () => {
    expect(failureCode(setActiveDataset(workspaceWithDataset(), { datasetId: 'missing' }))).toBe('DATASET_NOT_FOUND');
  });

  test('activates an existing dataset', () => {
    const result = setActiveDataset(workspaceWithDataset(), { datasetId: 'ds_sales' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workspace.activeDatasetId).toBe('ds_sales');
  });
});
