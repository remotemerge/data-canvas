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
  /**
   * Import is the primary action only where it is the one thing to do — the empty canvas. In the
   * always-present sidebar it is one tool among many, so it renders quietly and leaves the screen
   * with a single blue call to action.
   */
  emphasis?: 'primary' | 'secondary';
}

/**
 * Picks a local file and drives the import through the shared dispatcher.
 *
 * No engine access whatsoever. The component validates nothing itself beyond calling the shared
 * pre-ingestion check for immediate feedback; the same check runs again inside the engine, which is
 * what makes it a guarantee rather than a courtesy — an agent-initiated import never passes here.
 *
 * The three-step sequence mirrors the action model: commit `loading`, ingest, then commit `ready`
 * or `error`. The `datasetId` from the first commit threads through the rest, so a failure always
 * has a specific dataset to mark rather than leaving a stranded placeholder.
 */
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

    // The placeholder must not stay at `loading`. Marking it failed is itself a dispatched action,
    // so the failure is revisioned and visible to an agent reading the workspace.
    await failDatasetImport({ datasetId, reason: imported.error.message });
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];

    // Resetting the input lets the same file be chosen twice in a row, which otherwise fires no
    // change event and looks like the button has stopped working.
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
      {/*
        The visible button owns the interaction and forwards clicks here, so this input is hidden
        from the accessibility tree: left exposed it was a second tab stop announcing an unnamed
        "Choose File", duplicating the button that already carries the name.
      */}
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

/**
 * Reports import progress honestly per phase.
 *
 * Only the reading phase gets a determinate bar, because only it knows how much is left. DuckDB
 * reports nothing during ingestion, so inventing a percentage there would produce the stalled-at-90%
 * bar that teaches users to distrust progress indicators.
 */
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
