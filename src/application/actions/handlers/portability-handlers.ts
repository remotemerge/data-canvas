import type { ImportWorkspaceInput } from '@/application/actions/action-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { ok } from '@/shared/result/result.ts';

/**
 * Commits a workspace restored from an archive.
 *
 * Validation, ID regeneration, and relation creation all happened in `importArchive` before this
 * action was dispatched, because they are asynchronous and can fail — doing them here would make a
 * handler that either blocks the dispatcher queue or commits a half-restored workspace. By the time
 * this runs, the only remaining step is the atomic swap.
 *
 * The whole workspace is replaced rather than merged. Two independent entity graphs have no
 * well-defined union, and a guess would silently lose work; the export/import round trip is a move,
 * not a combine.
 *
 * The revision continues from the current one rather than restarting. Revision numbers describe this
 * browser's action sequence, not the archive's history, and rewinding one would break the
 * optimistic-concurrency contract for any agent holding a revision from before the import.
 */
export const handleImportWorkspace: ActionHandler<ImportWorkspaceInput> = (workspace, payload) => {
  const imported = payload.workspace;
  const changedEntityIds = [
    ...Object.keys(imported.datasets),
    ...Object.keys(imported.visualizations),
    ...Object.keys(imported.filters),
    ...Object.keys(imported.metrics),
    ...Object.keys(imported.annotations),
    ...Object.keys(imported.relationships),
    ...Object.keys(imported.derivedColumns),
  ];
  const missing = payload.missingDatasetNames.length;

  return ok({
    workspace: {
      ...imported,
      // Identity and revision stay with the live workspace: this is a replacement of contents, and
      // the store's subscribers track the workspace by ID.
      id: workspace.id,
      revision: workspace.revision,
      createdAt: workspace.createdAt,
    },
    changedEntityIds,
    summary:
      missing === 0
        ? `Imported a workspace with ${Object.keys(imported.datasets).length} datasets.`
        : `Imported a workspace with ${Object.keys(imported.datasets).length} datasets; ${missing} had no data in the archive.`,
  });
};
