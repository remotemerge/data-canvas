export interface WorkspaceLock {
  mode: 'writer' | 'reader';
  release(): void;
}

const ignoreRelease = (): void => undefined;

export const acquireWorkspaceLock = async (name = 'data-canvas-workspace'): Promise<WorkspaceLock> => {
  if (navigator.locks === undefined) return { mode: 'writer', release: ignoreRelease };
  let release = ignoreRelease;
  let acquired!: (value: boolean) => void;
  const ready = new Promise<boolean>((resolve) => (acquired = resolve));
  void navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
    acquired(lock !== null);
    if (lock === null) return;
    await new Promise<void>((resolve) => (release = resolve));
  });
  return (await ready) ? { mode: 'writer', release } : { mode: 'reader', release: ignoreRelease };
};
