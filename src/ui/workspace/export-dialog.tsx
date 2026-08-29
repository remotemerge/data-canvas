import { useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { ExportMode } from '@/data/portability/archive-manifest.ts';
import { exportFileName, exportWorkspace, type ExportProgress } from '@/data/portability/export-workspace.ts';
import { APP_VERSION } from '@/shared/app-version.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { saveArchive } from '@/ui/workspace/save-archive.ts';

/**
 * Exports the workspace to a file.
 *
 * The two modes are described by what leaves the browser, not by their internal names. A user who
 * misreads this control shares their data by accident, which is the single worst failure this
 * product can have — so `definition-only` is preselected and the data-bearing mode says plainly
 * that it includes the rows.
 */
export const ExportDialog = ({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (error: DomainError) => void;
}): React.JSX.Element => {
  const workspace = useWorkspace((state) => state.workspace);
  const [mode, setMode] = useState<ExportMode>('definition-only');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const datasetCount = Object.values(workspace.datasets).filter((set) => set.importStatus === 'ready').length;

  const run = async (): Promise<void> => {
    setBusy(true);
    setProgress(null);

    const outcome = await saveArchive(exportFileName(workspace, mode), (write) =>
      exportWorkspace({
        workspace,
        mode,
        appVersion: APP_VERSION,
        dataEngine: registeredDataEngine,
        write,
        onProgress: setProgress,
      }),
    );

    setBusy(false);

    if (!outcome.ok) {
      onError(outcome.error);

      return;
    }

    onClose();
  };

  return (
    <div className="dialog">
      <h2 id="export-dialog-title">Export workspace</h2>

      <fieldset className="dialog__field">
        <legend>What to include</legend>

        <label className="dialog__choice">
          <input
            type="radio"
            name="export-mode"
            value="definition-only"
            checked={mode === 'definition-only'}
            onChange={() => setMode('definition-only')}
          />
          <span>
            <strong>Structure only — no data leaves your browser</strong>
            <span className="dialog__hint">
              Charts, filters, metrics, and relationships. Your imported rows are not included.
            </span>
          </span>
        </label>

        <label className="dialog__choice">
          <input
            type="radio"
            name="export-mode"
            value="full"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
          />
          <span>
            <strong>Everything, including your data</strong>
            <span className="dialog__hint">
              {datasetCount === 1
                ? 'The file will contain all rows from 1 imported dataset. Anyone you send it to can read that data.'
                : `The file will contain all rows from ${datasetCount} imported datasets. Anyone you send it to can read that data.`}
            </span>
          </span>
        </label>
      </fieldset>

      {progress === null ? null : (
        <p className="dialog__progress" role="status">
          {progress.step === 'dataset' ? 'Writing data' : 'Preparing'} — {progress.completed} of {progress.total}
        </p>
      )}

      <div className="dialog__actions">
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
};
