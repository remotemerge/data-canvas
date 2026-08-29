import { useEffect, useState } from 'react';
import {
  estimateStorage,
  requestPersistentStorage,
  type StorageEstimate,
} from '@/data/persistence/storage-estimate.ts';

const formatBytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

const clearWorkspace = async (): Promise<void> => {
  if (!window.confirm('Clear this workspace and all imported data from this browser?')) return;
  await navigator.storage.getDirectory().then((root) => root.removeEntry('data-canvas.db'));
  window.location.reload();
};

export const StoragePanel = (): React.JSX.Element => {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    void estimateStorage().then(setEstimate);
    const showSaveFailure = (): void => setSaveFailed(true);
    window.addEventListener('data-canvas:persistence-error', showSaveFailure);
    return () => window.removeEventListener('data-canvas:persistence-error', showSaveFailure);
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
          {formatBytes(estimate.usage)} used of {formatBytes(estimate.quota)}.
        </p>
      )}
      <button type="button" onClick={() => void requestPersistence()} disabled={estimate?.persisted}>
        Keep data on device
      </button>
      <button type="button" onClick={() => void clearWorkspace()}>
        Clear workspace
      </button>
    </section>
  );
};
