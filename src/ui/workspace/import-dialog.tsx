import { useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import { importArchive } from '@/data/portability/import-archive.ts';
import { MAX_ARCHIVE_BYTES } from '@/data/portability/archive-manifest.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';

/**
 * Restores a workspace from an archive file.
 *
 * The replacement is stated before it happens rather than after. Import creates a new workspace
 * rather than merging, so whatever is currently open is discarded — a consequence a user must
 * agree to knowingly, since nothing here can undo it once the current workspace is gone.
 */
export const ImportDialog = ({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (error: DomainError) => void;
}): React.JSX.Element => {
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);

  const run = async (file: File): Promise<void> => {
    setBusy(true);
    setMissing(null);

    if (file.size > MAX_ARCHIVE_BYTES) {
      setBusy(false);
      onError({ code: 'RESULT_LIMIT_EXCEEDED', message: 'That archive is too large to import.' });

      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const restored = await importArchive(bytes, registeredDataEngine);

    if (!restored.ok) {
      setBusy(false);
      onError(restored.error);

      return;
    }

    const committed = await actions.importWorkspace({
      workspace: restored.value.workspace,
      missingDatasetNames: restored.value.missingDatasetNames,
    });

    setBusy(false);

    if (!committed.ok) {
      onError(committed.error);

      return;
    }

    // A definition-only archive restores structure without rows. Reported rather than left to be
    // discovered when a chart fails to render.
    if (restored.value.missingDatasetNames.length > 0) {
      setMissing(restored.value.missingDatasetNames);

      return;
    }

    onClose();
  };

  if (missing !== null) {
    return (
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <h2 id="import-dialog-title">Workspace imported</h2>
        <p>The structure was restored, but this archive carried no data for:</p>
        <ul className="dialog__list">
          {missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="dialog__hint">Import those files again to make the charts that use them work.</p>
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
      <h2 id="import-dialog-title">Import workspace</h2>
      <p>This replaces everything currently open. Export the current workspace first if you want to keep it.</p>

      <input
        type="file"
        accept=".zip"
        disabled={busy}
        aria-label="Workspace archive"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file !== undefined) void run(file);
        }}
      />

      {busy ? (
        <p className="dialog__progress" role="status">
          Importing…
        </p>
      ) : null}

      <div className="dialog__actions">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
};
