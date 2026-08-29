import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import {
  computeChecksum,
  isArchiveManifest,
  MANIFEST_ENTRY,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_FILES,
  MAX_DECOMPRESSED_BYTES,
  MAX_ENTITIES_PER_TYPE,
  MAX_WORKSPACE_JSON_BYTES,
  WORKSPACE_ENTRY,
  type ArchiveManifest,
} from '@/data/portability/archive-manifest.ts';
import { migrateStoredWorkspace } from '@/data/persistence/migrations/migrate-workspace.ts';
import { remapWorkspaceIds } from '@/data/portability/remap-entity-ids.ts';
import { ArchiveFormatError, readArchive } from '@/data/portability/workspace-archive.ts';
import { deserializeEntity, isWorkspacePayload } from '@/data/persistence/schema/entity-serialization.ts';
import { CURRENT_SCHEMA_VERSION, type Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface ImportedWorkspace {
  workspace: Workspace;
  /** Datasets whose rows were not in the archive, because it was a `definition-only` export. */
  missingDatasetNames: string[];
}

const textDecoder = new TextDecoder();

const rejected = (message: string): Result<never, DomainError> => err(domainError('UNSUPPORTED_OPERATION', message));

const entityCountsWithinBounds = (workspace: Workspace): boolean =>
  [
    workspace.datasets,
    workspace.derivedColumns,
    workspace.relationships,
    workspace.visualizations,
    workspace.filters,
    workspace.selections,
    workspace.metrics,
    workspace.annotations,
  ].every((record) => Object.keys(record).length <= MAX_ENTITIES_PER_TYPE);

/**
 * Restores a workspace from an archive.
 *
 * Every step treats the archive as hostile input. The order matters: nothing is interpreted before
 * its bytes have been checksummed, no entity is trusted before its shape is validated, and no
 * relation is created before the workspace it belongs to has been fully remapped. A failure at any
 * point returns a message and leaves the application's state untouched, because the new workspace is
 * only handed to the caller on success.
 *
 * The result is a **new** workspace. Merging into the current one would need a rule for two
 * independent entity graphs that happen to describe the same data, and any rule guessed here would
 * silently lose someone's work.
 */
export const importArchive = async (
  bytes: Uint8Array,
  dataEngine: DataEnginePort,
): Promise<Result<ImportedWorkspace, DomainError>> => {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    return rejected('That archive is too large to import.');
  }

  let entries: Map<string, Uint8Array>;

  try {
    entries = readArchive(bytes, {
      maxFiles: MAX_ARCHIVE_FILES,
      maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
    });
  } catch (error) {
    return rejected(
      error instanceof ArchiveFormatError ? error.message : 'That file is not a readable workspace archive.',
    );
  }

  const manifestBytes = entries.get(MANIFEST_ENTRY);

  if (manifestBytes === undefined) return rejected('The archive has no manifest and cannot be imported.');

  let manifest: unknown;

  try {
    manifest = JSON.parse(textDecoder.decode(manifestBytes)) as unknown;
  } catch {
    return rejected("The archive's manifest is not readable.");
  }

  if (!isArchiveManifest(manifest)) return rejected("The archive's manifest is not valid.");

  const validManifest: ArchiveManifest = manifest;
  const workspaceBytes = entries.get(WORKSPACE_ENTRY);

  if (workspaceBytes === undefined) return rejected('The archive contains no workspace definition.');
  if (workspaceBytes.byteLength > MAX_WORKSPACE_JSON_BYTES) {
    return rejected("The archive's workspace definition is too large to import.");
  }

  if ((await computeChecksum(workspaceBytes)) !== validManifest.workspaceChecksum) {
    return rejected('The archive is corrupt or was modified after it was exported.');
  }

  let parsed: unknown;

  try {
    parsed = deserializeEntity(textDecoder.decode(workspaceBytes));
  } catch {
    return rejected("The archive's workspace definition is not readable.");
  }

  // The same migration chain as OPFS hydration, for the same reason: an archive exported by an
  // older build carries an older schema, and validating it against today's shape before upgrading
  // it would reject a workspace that is merely old rather than malformed. An archive from a *newer*
  // build is refused here instead of being partially understood.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return rejected("The archive's workspace definition is not valid.");
  }

  const migrated = migrateStoredWorkspace(parsed as Record<string, unknown>);

  if (!migrated.ok) return err(migrated.error);
  if (!isWorkspacePayload(migrated.value)) return rejected("The archive's workspace definition is not valid.");

  const workspacePayload: Workspace = migrated.value;

  if (!entityCountsWithinBounds(workspacePayload)) {
    return rejected('The archive contains more entities than can be imported.');
  }

  // Checksums for every data file are verified before any of them is handed to DuckDB, so a
  // corrupt archive fails before it has created a single relation.
  for (const file of validManifest.files) {
    const data = entries.get(file.path);

    if (data === undefined) return rejected('The archive is missing a data file its manifest lists.');
    if (data.byteLength !== file.byteSize) return rejected('The archive is corrupt or was modified after export.');
    // eslint-disable-next-line no-await-in-loop
    if ((await computeChecksum(data)) !== file.checksum) {
      return rejected('The archive is corrupt or was modified after it was exported.');
    }
  }

  const remapped = remapWorkspaceIds(workspacePayload);

  if (remapped.danglingReferences.length > 0) {
    return rejected('The archive references entities it does not define and cannot be imported.');
  }

  // Old relation IDs index the archive's files; new ones are generated by the engine on import.
  const oldRelationIds = new Map(
    Object.values(workspacePayload.datasets).map((dataset) => [dataset.id, dataset.relationId] as const),
  );
  const oldByPosition = Object.values(workspacePayload.datasets);
  const newByPosition = Object.values(remapped.workspace.datasets);
  const missingDatasetNames: string[] = [];
  const restored: Record<string, Workspace['datasets'][string]> = {};

  for (const [index, dataset] of newByPosition.entries()) {
    const original = oldByPosition[index];

    if (original === undefined) continue;

    const relationId = oldRelationIds.get(original.id);
    const file = validManifest.files.find((entry) => entry.path.endsWith(`/${relationId}.parquet`));
    const data = file === undefined ? undefined : entries.get(file.path);

    if (data === undefined) {
      // A `definition-only` archive, or a dataset that failed to export. The structure is kept so
      // the charts referencing it survive; the dataset is marked so queries fail with a clear
      // message rather than against a relation that does not exist.
      missingDatasetNames.push(dataset.name);
      restored[dataset.id] = { ...dataset, importStatus: 'error', rowCount: null };
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const imported = await dataEngine.importDatasetParquet(dataset.id, data);

    if (!imported.ok) return imported;

    // The engine describes the relation it actually created. Trusting the archive's column metadata
    // instead would let a mismatched file produce a workspace whose charts reference absent columns.
    const declaredNames = dataset.columns.map((column) => column.physicalName).join(',');
    const actualNames = imported.value.columns.map((column) => column.physicalName).join(',');

    if (declaredNames !== actualNames) {
      return rejected(`The data for '${dataset.name}' does not match the columns the archive declares.`);
    }

    restored[dataset.id] = {
      ...dataset,
      relationId: imported.value.relationId,
      rowCount: imported.value.rowCount,
      // Column identity comes from the remapped definition, since bindings and filters already
      // reference those IDs; only the engine-owned physical facts are taken from the import.
      columns: dataset.columns.map((column, position) => ({
        ...column,
        databaseType: imported.value.columns[position]?.databaseType ?? column.databaseType,
        logicalType: imported.value.columns[position]?.logicalType ?? column.logicalType,
      })),
      importStatus: 'ready',
    };
  }

  return ok({
    workspace: {
      ...remapped.workspace,
      datasets: restored,
      // Migration has already brought the payload up to date; recording it keeps the next export
      // and the next checkpoint from claiming the version the archive happened to be written at.
      schemaVersion: CURRENT_SCHEMA_VERSION,
      // A fresh history: the imported workspace has no undoable past in this browser.
      revision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    missingDatasetNames,
  });
};
