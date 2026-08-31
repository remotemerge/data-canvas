import { useId, useRef, useState } from 'react';
import { FILE_INPUT_ACCEPT } from '@/data/import/import-limits.ts';
import { validateImportFile } from '@/data/import/import-dataset.ts';
import type { ImportProgress } from '@/application/ports/data-engine-port.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { selectEngineStatus, useEngineStatus } from '@/state/use-engine-status.ts';
import { measureAsync } from '@/shared/perf/performance-marks.ts';

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
  const engineStatus = useEngineStatus(selectEngineStatus);
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

    if (datasetId === undefined) return;

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

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];

    // Clear the input so choosing the same file fires change again.
    event.target.value = '';

    if (file === undefined) return;

    setBusy(true);
    void runImport(file).finally(() => {
      setBusy(false);
      setProgress(null);
    });
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
