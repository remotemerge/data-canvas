import type {
  BeginDatasetImportInput,
  FailDatasetImportInput,
  ImportDatasetInput,
  SetActiveDatasetInput,
} from '@/application/actions/action-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

/** Bound on the display name so a pathological filename cannot bloat state or the history panel. */
export const MAX_DATASET_NAME_LENGTH = 200;

/**
 * Commits the `loading` placeholder that the rest of the import resolves.
 *
 * Ingestion of a large file takes seconds, so the placeholder exists to make that visible. It is a
 * dispatched action rather than component state for the same reason every other change is: a human
 * and an agent must see the same in-progress import, and only the store can give them that.
 *
 * `relationId` is empty until the engine creates the relation. Nothing may query the dataset while
 * `importStatus` is `loading`, which is what makes the empty value safe rather than a hole.
 */
export const handleBeginDatasetImport: ActionHandler<BeginDatasetImportInput> = (workspace, payload) => {
  const name = payload.name.trim();

  if (name.length === 0 || name.length > MAX_DATASET_NAME_LENGTH) {
    return err(
      domainError('IMPORT_FAILED', `Dataset name must be between 1 and ${MAX_DATASET_NAME_LENGTH} characters.`, {
        maxLength: MAX_DATASET_NAME_LENGTH,
      }),
    );
  }

  const dataset: Dataset = {
    id: createEntityId(ID_PREFIX.dataset),
    name,
    relationId: '',
    source: {
      kind: payload.sourceKind,
      fileName: name,
      byteSize: Math.max(Math.trunc(payload.byteSize) || 0, 0),
      importedAt: new Date().toISOString(),
    },
    rowCount: null,
    columns: [],
    revision: 0,
    importStatus: 'loading',
  };

  return ok({
    workspace: {
      ...workspace,
      datasets: { ...workspace.datasets, [dataset.id]: dataset },
      // The first import becomes active so the UI has something to show without a second action.
      activeDatasetId: workspace.activeDatasetId ?? dataset.id,
    },
    changedEntityIds: [dataset.id],
    summary: `Started importing dataset '${dataset.name}'.`,
  });
};

/**
 * Resolves a loading dataset to `ready` using the engine's inspection of the real relation.
 *
 * Ingestion belongs to the data engine; this handler owns validation and the resulting `Dataset`
 * metadata. When no engine is wired the import fails with `ENGINE_UNAVAILABLE` rather than
 * committing a dataset describing a relation that does not exist.
 */
export const handleImportDataset: ActionHandler<ImportDatasetInput> = async (workspace, payload, deps) => {
  const existing = resolveDataset(workspace, payload.datasetId);

  if (!existing.ok) return existing;

  if (existing.value.importStatus !== 'loading') {
    return err(
      domainError('IMPORT_FAILED', 'That dataset has already finished importing.', {
        importStatus: existing.value.importStatus,
      }),
    );
  }

  if (payload.file === undefined || payload.file === null) {
    return err(domainError('IMPORT_FAILED', 'No file was supplied for import.'));
  }

  const imported = await deps.dataEngine.importFile(payload.file, existing.value.id, payload.onProgress);

  if (!imported.ok) return imported;

  const dataset: Dataset = {
    ...existing.value,
    relationId: imported.value.relationId,
    rowCount: imported.value.rowCount,
    columns: imported.value.columns,
    revision: existing.value.revision + 1,
    importStatus: 'ready',
  };

  return ok({
    workspace: { ...workspace, datasets: { ...workspace.datasets, [dataset.id]: dataset } },
    changedEntityIds: [dataset.id],
    summary: `Imported dataset '${dataset.name}' with ${dataset.columns.length} columns.`,
  });
};

/**
 * Marks a loading dataset as failed.
 *
 * The failure is committed rather than merely surfaced in the UI so the workspace never keeps a
 * dataset stuck at `loading` after an import that will not finish. `reason` reaches an agent
 * through the history summary, so callers pass a `DomainError.message`, which is already
 * constrained to contain no file contents.
 */
export const handleFailDatasetImport: ActionHandler<FailDatasetImportInput> = (workspace, payload) => {
  const existing = resolveDataset(workspace, payload.datasetId);

  if (!existing.ok) return existing;

  const dataset: Dataset = {
    ...existing.value,
    revision: existing.value.revision + 1,
    importStatus: 'error',
  };

  const { activeDatasetId, ...rest } = workspace;
  const nextActive = activeDatasetId === dataset.id ? undefined : activeDatasetId;

  return ok({
    workspace: {
      ...rest,
      // A failed dataset must not stay active: every downstream view would query a relation that
      // was never created.
      ...(nextActive === undefined ? {} : { activeDatasetId: nextActive }),
      datasets: { ...workspace.datasets, [dataset.id]: dataset },
    },
    changedEntityIds: [dataset.id],
    summary: `Import of dataset '${dataset.name}' failed: ${payload.reason}`,
  });
};

export const handleSetActiveDataset: ActionHandler<SetActiveDatasetInput> = (workspace, payload) => {
  if (payload.datasetId === undefined) {
    const { activeDatasetId: _cleared, ...rest } = workspace;

    return ok({
      workspace: rest,
      changedEntityIds: [],
      summary: 'Cleared the active dataset.',
    });
  }

  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) return dataset;

  return ok({
    workspace: { ...workspace, activeDatasetId: dataset.value.id },
    changedEntityIds: [dataset.value.id],
    summary: `Activated dataset '${dataset.value.name}'.`,
  });
};
