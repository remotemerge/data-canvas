import { requiredDatasetCount } from '@/webmcp/registry/tool-types.ts';
import type { ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { createToolDefinitions, executeTool } from '@/webmcp/registry/tool-registry.ts';
import { setToolStatus } from '@/webmcp/registry/tool-status.ts';
import { workspaceStore } from '@/state/workspace-store.ts';
import { getPerformanceRecords } from '@/shared/perf/performance-marks.ts';
import { getRecordedRequests, installNetworkRecorder } from '@/app/bootstrap/network-recorder.ts';

declare global {
  interface Window {
    __dataCanvas?: {
      normalizedState(): unknown;
      revision(): number;
      history(): unknown;
      networkLog(): unknown;
      perf(): unknown;
      tools(): string[];
      executeTool(name: string, input: unknown): Promise<string>;
    };
  }
}

const readyDatasetCount = (): number =>
  Object.values(workspaceStore.getState().workspace.datasets).filter((dataset) => dataset.importStatus === 'ready')
    .length;

export const installTestHooks = (deps: ToolDependencies): void => {
  if (!import.meta.env.DEV) return;
  installNetworkRecorder();
  const tools = createToolDefinitions(deps);
  const availableTools = (): string[] =>
    tools.filter((tool) => requiredDatasetCount(tool) <= readyDatasetCount()).map((tool) => tool.name);
  const updateStatus = (): void => {
    const names = availableTools();
    setToolStatus({ available: names.length > 0, registeredCount: names.length });
  };
  updateStatus();
  workspaceStore.subscribe(() => updateStatus());
  // eslint-disable-next-line no-underscore-dangle -- required by the browser verification API.
  window.__dataCanvas = {
    normalizedState: () => structuredClone(workspaceStore.getState().workspace),
    revision: () => workspaceStore.getState().workspace.revision,
    history: () => structuredClone(workspaceStore.getState().history),
    networkLog: () => getRecordedRequests(),
    perf: () => getPerformanceRecords(),
    tools: () => availableTools(),
    executeTool: async (name, input) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool === undefined) throw new Error(`Unknown Data Canvas tool: ${name}`);
      return executeTool(tool, input);
    },
  };
};
