import { useEffect, useState } from 'react';
import {
  estimateStorage,
  requestPersistentStorage,
  type StorageEstimate,
} from '@/data/persistence/storage-estimate.ts';
import { OPFS_DATABASE_FILE } from '@/data/persistence/opfs-database.ts';
import { Button } from '@/ui/components/ui/button.tsx';

const formatBytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Scales the unit to the measured size so a small workspace reports its real footprint instead of
 * rounding away to `0.0 MB`.
 */
export const formatUsage = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  // Rounding is applied before the unit is chosen: 1_048_575 B rounds to 1024 KB, which should read
  // as 1.0 MB rather than a kilobyte figure that has reached the next unit.
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) return `${kilobytes} KB`;
  return formatBytes(bytes);
};

const clearWorkspace = async (): Promise<void> => {
  if (!window.confirm('Clear this workspace and all imported data from this browser?')) return;
  try {
    await navigator.storage.getDirectory().then((root) => root.removeEntry(OPFS_DATABASE_FILE));
  } catch {
    // The browser can retain a read-only OPFS handle after the database has already been cleared.
  }
  window.location.reload();
};

export const StoragePanel = (): React.JSX.Element => {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    let active = true;
    // Guarded against the unmounted case: each checkpoint schedules a fresh estimate, and the panel
    // unmounts whenever the inspector closes.
    const refresh = (): void => {
      void estimateStorage().then((next) => {
        if (active) setEstimate(next);
      });
    };
    refresh();
    const showSaveFailure = (): void => setSaveFailed(true);
    const onSaved = (): void => {
      setSaveFailed(false);
      refresh();
    };
    window.addEventListener('data-canvas:persistence-error', showSaveFailure);
    window.addEventListener('data-canvas:persistence-saved', onSaved);
    return () => {
      active = false;
      window.removeEventListener('data-canvas:persistence-error', showSaveFailure);
      window.removeEventListener('data-canvas:persistence-saved', onSaved);
    };
  }, []);
  const requestPersistence = async (): Promise<void> => {
    await requestPersistentStorage();
    setEstimate(await estimateStorage());
  };
  return (
    <section aria-labelledby="storage-title">
      <h2 id="storage-title" className="workspace__panel-heading">
        Storage
      </h2>
      <p>Workspace data is stored in this browser on this device. Clearing site data deletes it.</p>
      <p>This workspace is not backed up.</p>
      {saveFailed ? <p role="alert">Changes are not saved. Data Canvas will retry after the next change.</p> : null}
      {estimate === null ? null : (
        <p>
          {formatUsage(estimate.usage)} used of {formatBytes(estimate.quota)}.
        </p>
      )}
      <div className="storage__actions">
        <Button variant="outline" onClick={() => void requestPersistence()} disabled={estimate?.persisted}>
          Keep data on device
        </Button>
        <Button variant="outline" onClick={() => void clearWorkspace()}>
          Clear workspace
        </Button>
      </div>
    </section>
  );
};
