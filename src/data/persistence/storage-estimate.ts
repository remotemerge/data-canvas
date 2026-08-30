import { OPFS_DATABASE_FILE } from '@/data/persistence/opfs-database.ts';

export interface StorageEstimate {
  usage: number;
  quota: number;
  persisted: boolean;
}

/**
 * Exact byte size of the workspace database, or 0 before it has been created.
 *
 * `StorageManager.estimate()` is not used for this. Its `usage` is origin-wide and browsers
 * deliberately pad and round it to resist cross-origin size fingerprinting, so a freshly imported
 * dataset can leave the reported figure unchanged. Reading the OPFS file's own size reports what
 * the workspace actually occupies.
 */
const databaseSize = async (): Promise<number> => {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_DATABASE_FILE);
    return (await handle.getFile()).size;
  } catch {
    // Absent until the first checkpoint writes it; nothing is stored yet.
    return 0;
  }
};

export const estimateStorage = async (): Promise<StorageEstimate | null> => {
  if (navigator.storage?.estimate === undefined) return null;
  const estimate = await navigator.storage.estimate();
  return {
    usage: await databaseSize(),
    // Still taken from the padded origin-wide estimate: a quota is a browser-assigned budget with
    // no per-file equivalent, and its approximation carries none of the precision problem.
    quota: estimate.quota ?? 0,
    persisted: (await navigator.storage.persisted?.()) ?? false,
  };
};

export const requestPersistentStorage = async (): Promise<boolean> => (await navigator.storage?.persist?.()) ?? false;
