import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import {
  computeChecksum,
  DATA_PREFIX,
  MANIFEST_ENTRY,
  WORKSPACE_ENTRY,
  type ArchiveFileEntry,
  type ArchiveManifest,
  type ExportMode,
} from '@/data/portability/archive-manifest.ts';
import { ZipWriter } from '@/data/portability/workspace-archive.ts';
import { serializeEntity } from '@/data/persistence/schema/entity-serialization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface ExportProgress {
  /** Completed units of work, where each dataset and the metadata write are one unit each. */
  completed: number;
  total: number;
  /** Display label for the current step. Dataset *names* are user content, so this is generic. */
  step: 'metadata' | 'dataset' | 'finalizing';
}

export interface ExportRequest {
  workspace: Workspace;
  mode: ExportMode;
  appVersion: string;
  dataEngine: DataEnginePort;
  /** Receives each chunk in order. The caller decides where an archive lands. */
  write(chunk: Uint8Array): Promise<void>;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

const textEncoder = new TextEncoder();

const aborted = (): DomainError =>
  domainError('UNSUPPORTED_OPERATION', 'The export was cancelled before it finished.', { aborted: true });

/** Archive member for a dataset. Uses the generated relation ID, never the user-facing name. */
const datasetEntryPath = (relationId: string): string => `${DATA_PREFIX}${relationId}.parquet`;

const countEntities = (workspace: Workspace): Record<string, number> => ({
  datasets: Object.keys(workspace.datasets).length,
  derivedColumns: Object.keys(workspace.derivedColumns).length,
  relationships: Object.keys(workspace.relationships).length,
  visualizations: Object.keys(workspace.visualizations).length,
  filters: Object.keys(workspace.filters).length,
  selections: Object.keys(workspace.selections).length,
  metrics: Object.keys(workspace.metrics).length,
  annotations: Object.keys(workspace.annotations).length,
});

/**
 * Writes a workspace archive to the caller's sink.
 *
 * Entries are emitted as they are produced rather than gathered into one buffer: a `full` export of
 * a large workspace would otherwise need a multi-gigabyte `Blob`, which is exactly the
 * rows-in-JavaScript cost the architecture exists to avoid. Only one dataset's Parquet bytes are
 * held at a time.
 *
 * The manifest is written **last**. Its checksums cannot be known until the files exist, and a
 * reader that finds a manifest has, by that fact, a complete archive.
 */
export const exportWorkspace = async (request: ExportRequest): Promise<Result<void, DomainError>> => {
  const { workspace, mode, dataEngine, signal } = request;
  const datasets = Object.values(workspace.datasets).filter((dataset) => dataset.importStatus === 'ready');
  const datasetCount = mode === 'full' ? datasets.length : 0;
  const total = datasetCount + 2;
  let completed = 0;

  const report = (step: ExportProgress['step']): void => {
    request.onProgress?.({ completed, total, step });
  };

  /**
   * Reads the signal's current state.
   *
   * A function rather than an inline check, matching the dispatcher: narrowing from the first test
   * would otherwise convince the compiler that a later test is unreachable, even though the signal
   * can abort across the awaits between them.
   */
  const isAborted = (): boolean => signal?.aborted ?? false;

  const writer = new ZipWriter(request.write);
  const files: ArchiveFileEntry[] = [];

  try {
    if (isAborted()) return err(aborted());

    report('metadata');

    // The persisted entity serialization, so an archive and a checkpoint can never disagree about
    // how the domain model is written down.
    const workspaceBytes = textEncoder.encode(serializeEntity(workspace));
    const workspaceChecksum = await computeChecksum(workspaceBytes);

    await writer.addEntry(WORKSPACE_ENTRY, workspaceBytes);
    completed += 1;

    if (mode === 'full') {
      for (const dataset of datasets) {
        if (isAborted()) return err(aborted());

        report('dataset');

        // Sequential on purpose: each dataset's bytes are released before the next is produced, so
        // peak memory is one dataset rather than all of them.
        // eslint-disable-next-line no-await-in-loop
        const exported = await dataEngine.exportDatasetParquet(dataset.id);

        if (!exported.ok) return exported;

        const path = datasetEntryPath(dataset.relationId);
        // eslint-disable-next-line no-await-in-loop
        const checksum = await computeChecksum(exported.value);

        // eslint-disable-next-line no-await-in-loop
        await writer.addEntry(path, exported.value);
        files.push({ path, byteSize: exported.value.byteLength, checksum });
        completed += 1;
      }
    }

    report('finalizing');

    const manifest: ArchiveManifest = {
      appVersion: request.appVersion,
      exportedAt: new Date().toISOString(),
      mode,
      counts: countEntities(workspace),
      files,
      workspaceChecksum,
    };

    await writer.addEntry(MANIFEST_ENTRY, textEncoder.encode(JSON.stringify(manifest)));
    await writer.finish();
    completed += 1;
    report('finalizing');

    return ok(undefined);
  } catch {
    return err(domainError('UNSUPPORTED_OPERATION', 'The workspace could not be exported.'));
  }
};

/**
 * Suggested filename for an export. Derived from the workspace ID and date, not the workspace name,
 * which is user-supplied text that would otherwise reach the filesystem.
 */
export const exportFileName = (workspace: Workspace, mode: ExportMode): string => {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = mode === 'full' ? 'full' : 'definition';

  return `data-canvas-${workspace.id.slice(-8)}-${date}-${suffix}.dcw.zip`;
};
