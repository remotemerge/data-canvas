import type { ImportDatasetInput, SetActiveDatasetInput } from '@/application/actions/action-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

/** Bound on the display name so a pathological filename cannot bloat state or the history panel. */
export const MAX_DATASET_NAME_LENGTH = 200;

/**
 * Imports a file into the workspace.
 *
 * Ingestion belongs to the data engine; this handler owns identity, validation, and the resulting
 * `Dataset` metadata. When no engine is wired the import fails with `ENGINE_UNAVAILABLE` rather
 * than committing a dataset describing a relation that does not exist.
 */
export const handleImportDataset: ActionHandler<ImportDatasetInput> = async (workspace, payload, deps) => {
  const name = payload.name.trim();

  if (name.length === 0 || name.length > MAX_DATASET_NAME_LENGTH) {
    return err(
      domainError('IMPORT_FAILED', `Dataset name must be between 1 and ${MAX_DATASET_NAME_LENGTH} characters.`, {
        maxLength: MAX_DATASET_NAME_LENGTH,
      }),
    );
  }

  if (payload.file === undefined || payload.file === null) {
    return err(domainError('IMPORT_FAILED', 'No file was supplied for import.'));
  }

  const datasetId = createEntityId(ID_PREFIX.dataset);
  const imported = await deps.dataEngine.importFile(payload.file, datasetId);

  if (!imported.ok) return imported;

  const dataset: Dataset = {
    id: datasetId,
    name,
    relationId: imported.value.relationId,
    source: {
      kind: payload.sourceKind,
      fileName: name,
      byteSize: 0,
      importedAt: new Date().toISOString(),
    },
    rowCount: imported.value.rowCount,
    columns: imported.value.columns,
    revision: 0,
    importStatus: 'ready',
  };

  return ok({
    workspace: {
      ...workspace,
      datasets: { ...workspace.datasets, [dataset.id]: dataset },
      // The first import becomes active so the UI has something to show without a second action.
      activeDatasetId: workspace.activeDatasetId ?? dataset.id,
    },
    changedEntityIds: [dataset.id],
    summary: `Imported dataset '${dataset.name}' with ${dataset.columns.length} columns.`,
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
