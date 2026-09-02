export interface ToolStatusSnapshot {
  available: boolean;
  registeredCount: number;
  executingCount: number;
}

let snapshot: ToolStatusSnapshot = { available: false, registeredCount: 0, executingCount: 0 };
const listeners = new Set<() => void>();

export const getToolStatus = (): ToolStatusSnapshot => snapshot;
export const subscribeToolStatus = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setToolStatus = (partial: Partial<ToolStatusSnapshot>): void => {
  snapshot = { ...snapshot, ...partial };
  for (const listener of listeners) {
    listener();
  }
};
