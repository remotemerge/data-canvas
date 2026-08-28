import type { ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { resolveModelContextHost } from '@/webmcp/registry/model-context-host.ts';
import { createToolRegistry } from '@/webmcp/registry/tool-registry.ts';
import { setToolStatus } from '@/webmcp/registry/tool-status.ts';

export interface ToolLifecycleDependencies extends ToolDependencies {
  subscribeWorkspace(listener: () => void): () => void;
}

export const startToolLifecycle = async (deps: ToolLifecycleDependencies): Promise<() => void> => {
  const host = resolveModelContextHost();
  if (!host) {
    setToolStatus({ available: false, registeredCount: 0, executingCount: 0 });
    return () => undefined;
  }

  const registry = await createToolRegistry(host, deps);
  let enabled: boolean | undefined;
  const sync = (): void => {
    const next = Object.values(deps.getWorkspace().datasets).some((dataset) => dataset.importStatus === 'ready');
    if (next === enabled) return;
    enabled = next;
    void registry.setDatasetToolsEnabled(next);
  };
  sync();
  const unsubscribe = deps.subscribeWorkspace(sync);

  return () => {
    unsubscribe();
    registry.dispose();
  };
};
