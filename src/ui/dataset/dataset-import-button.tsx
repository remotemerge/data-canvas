import { useId, useRef, useState } from 'react';
import { FILE_INPUT_ACCEPT } from '@/data/import/import-limits.ts';
import { validateImportFile } from '@/data/import/import-dataset.ts';
import type { ImportProgress } from '@/application/ports/data-engine-port.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectDatasets } from '@/state/selectors/workspace-selectors.ts';
import { selectEngineStatus, useEngineStatus } from '@/state/use-engine-status.ts';
import { measureAsync } from '@/shared/perf/performance-marks.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/components/ui/dialog.tsx';

interface DatasetImportButtonProps {
  onError: (error: DomainError | null) => void;
  // Whether the button is shown as the primary empty-state action.
  emphasis?: 'primary' | 'secondary';
}

// Selects a local file and imports it through the shared dispatcher.
export const DatasetImportButton = ({ onError, emphasis = 'primary' }: DatasetImportButtonProps): React.JSX.Element => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  // A chosen file that matches an existing dataset, held until the duplicate prompt is answered.
  const [pendingDuplicate, setPendingDuplicate] = useState<{ file: File; existingName: string } | null>(null);
  const engineStatus = useEngineStatus(selectEngineStatus);
  const datasets = useWorkspace(selectDatasets);
  const { beginDatasetImport, importDataset, failDatasetImport } = useActions();

  const runImport = async (file: File): Promise<void> => {
    const validated = validateImportFile(file);

    if (!validated.ok) {
      onError(validated.error);

      return;
    }

    const started = await beginDatasetImport({
      name: validated.value.fileName,
      sourceKind: validated.value.sourceKind,
      byteSize: validated.value.byteSize,
    });

    if (!started.ok) {
      onError(started.error);

      return;
    }

    const datasetId = started.value.changedEntityIds[0];

    if (datasetId === undefined) {
      return;
    }

    const imported = await measureAsync('dataset-import', () =>
      importDataset({ file, datasetId, onProgress: setProgress }),
    );

    if (imported.ok) {
      onError(null);

      return;
    }

    onError(imported.error);

    // Mark the placeholder failed through the dispatcher.
    await failDatasetImport({ datasetId, reason: imported.error.message });
  };

  const startImport = (file: File): void => {
    setBusy(true);
    void runImport(file).finally(() => {
      setBusy(false);
      setProgress(null);
    });
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];

    // Clear the input so choosing the same file fires change again.
    event.target.value = '';

    if (file === undefined) {
      return;
    }

    /*
     * A matching file name and byte size almost always means the same file. Re-importing is a valid
     * choice, so this asks instead of blocking; without it an accidental double click silently loads
     * a second copy of the data into the engine.
     */
    const duplicate = Object.values(datasets).find(
      (dataset) =>
        dataset.importStatus === 'ready' &&
        dataset.source.fileName === file.name &&
        dataset.source.byteSize === file.size,
    );

    if (duplicate === undefined) {
      startImport(file);

      return;
    }

    setPendingDuplicate({ file, existingName: duplicate.name });
  };

  const disabled = busy || engineStatus !== 'ready';

  return (
    <div className="import">
      {/* The visible button owns the interaction, so the file input is hidden from the accessibility tree. */}
      <input
        ref={inputRef}
        id={inputId}
        className="import__input"
        type="file"
        accept={FILE_INPUT_ACCEPT}
        onChange={handleChange}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        type="button"
        className="import__button"
        data-emphasis={emphasis}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-busy={busy}
      >
        {busy ? 'Importing…' : 'Import data'}
      </button>

      {progress === null ? (
        <p className="import__hint">CSV, TSV, JSON, or NDJSON</p>
      ) : (
        <ImportProgressReadout progress={progress} />
      )}

      <Dialog open={pendingDuplicate !== null} onOpenChange={(open) => !open && setPendingDuplicate(null)}>
        <DialogContent>
          <DialogTitle>Import this file again?</DialogTitle>
          <DialogDescription>
            {pendingDuplicate === null
              ? ''
              : `'${pendingDuplicate.file.name}' looks like the dataset already imported as '${pendingDuplicate.existingName}'. Importing it again keeps both copies and uses more memory.`}
          </DialogDescription>
          <div className="workspace__dialog-actions">
            <Button variant="outline" size="sm" onClick={() => setPendingDuplicate(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (pendingDuplicate !== null) {
                  startImport(pendingDuplicate.file);
                }
                setPendingDuplicate(null);
              }}
            >
              Import anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Reports determinate progress only while the file is being read.
const ImportProgressReadout = ({ progress }: { progress: ImportProgress }): React.JSX.Element => {
  if (progress.phase !== 'reading' || progress.totalBytes === undefined || progress.totalBytes === 0) {
    return (
      <p className="import__progress" role="status" aria-live="polite">
        {progress.phase === 'ingesting' ? 'Loading into the engine…' : 'Inspecting columns…'}
      </p>
    );
  }

  const readBytes = progress.bytesRead ?? 0;
  const percent = Math.min(Math.round((readBytes / progress.totalBytes) * 100), 100);

  return (
    <p className="import__progress" role="status" aria-live="polite">
      <progress className="import__progress-bar" value={readBytes} max={progress.totalBytes} />
      Reading file — {percent}%
    </p>
  );
};
