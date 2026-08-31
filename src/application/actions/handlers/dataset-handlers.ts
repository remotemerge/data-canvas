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

// Maximum display-name length for dataset metadata and history entries.
export const MAX_DATASET_NAME_LENGTH = 200;

// Adds a loading dataset for the import to resolve.
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
      // Make the first imported dataset active so the UI has content immediately.
      activeDatasetId: workspace.activeDatasetId ?? dataset.id,
    },
    changedEntityIds: [dataset.id],
    summary: `Started importing dataset '${dataset.name}'.`,
  });
};

// Completes a loading dataset after the engine creates its relation.
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

// Marks a loading dataset as failed and records safe error text.
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
      // A failed dataset has no relation for downstream views to query.
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
