import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startEngine } from '@/app/bootstrap/start-engine.ts';
import { dispatcher } from '@/application/actions/dispatcher.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import { getColumnProfile } from '@/application/queries/column-statistics.ts';
import { getWorkspace, workspaceStore } from '@/state/workspace-store.ts';
import { startToolLifecycle } from '@/webmcp/registry/tool-lifecycle.ts';
import type { ToolLifecycleDependencies } from '@/webmcp/registry/tool-lifecycle.ts';
import { installTestHooks } from '@/app/bootstrap/test-hooks.ts';
import { WorkspacePage } from '@/ui/workspace/workspace-page.tsx';
import '@/ui/styles/global.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

/*
 * Start DuckDB alongside the initial render.
 *
 * The shell can paint without the engine. The import control and status banner communicate
 * readiness while startup runs.
 */
void startEngine();
const toolDependencies: ToolLifecycleDependencies = {
  dispatcher,
  getWorkspace,
  fetchTableWindow: (request) => registeredDataEngine.fetchTableWindow(request),
  executeAnalysis: (query) => registeredDataEngine.executeAnalysis(query),
  fetchColumnStatistics: (request) =>
    getColumnProfile(registeredDataEngine, getWorkspace(), request.datasetId, request.columnId, request.topValueLimit),
  subscribeWorkspace: (listener) => workspaceStore.subscribe(listener),
};
void startToolLifecycle(toolDependencies);
installTestHooks(toolDependencies);

createRoot(container).render(
  <StrictMode>
    <WorkspacePage />
  </StrictMode>,
);
