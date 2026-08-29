export interface StorageEstimate {
  usage: number;
  quota: number;
  persisted: boolean;
}

export const estimateStorage = async (): Promise<StorageEstimate | null> => {
  if (navigator.storage?.estimate === undefined) return null;
  const estimate = await navigator.storage.estimate();
  return {
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
    persisted: (await navigator.storage.persisted?.()) ?? false,
  };
};

export const requestPersistentStorage = async (): Promise<boolean> => (await navigator.storage?.persist?.()) ?? false;
