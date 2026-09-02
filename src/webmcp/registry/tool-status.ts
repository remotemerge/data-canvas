// One registered tool as the UI describes it. Mirrors the descriptor the agent host receives.
export interface RegisteredToolSummary {
  name: string;
  title: string;
  description: string;
  // Annotation flags as registered; read by name rather than exhaustively typed here.
  annotations: Readonly<Record<string, unknown>>;
  inputSchema: object;
}

export interface ToolStatusSnapshot {
  available: boolean;
  registeredCount: number;
  executingCount: number;
  // Currently registered tools, so the UI can show the contract behind the count.
  tools: RegisteredToolSummary[];
}

let snapshot: ToolStatusSnapshot = { available: false, registeredCount: 0, executingCount: 0, tools: [] };
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
