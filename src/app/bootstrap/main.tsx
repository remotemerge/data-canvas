import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from '@/app/routing/app-routes.tsx';
import { startEngine } from '@/app/bootstrap/start-engine.ts';
import { dispatcher } from '@/application/actions/dispatcher.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import { getWorkspace, workspaceStore } from '@/state/workspace-store.ts';
import { startToolLifecycle } from '@/webmcp/registry/tool-lifecycle.ts';
import '@/ui/styles/global.scss';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

/*
 * DuckDB starts alongside the first render rather than blocking it.
 *
 * Instantiating the Wasm module takes long enough to be visible, and nothing in the shell needs the
 * engine to paint. The import button stays disabled and the engine banner reports progress until
 * `startEngine` resolves, so readiness is communicated rather than the app appearing inert.
 */
void startEngine();
void startToolLifecycle({
  dispatcher,
  getWorkspace,
  fetchTableWindow: (request) => registeredDataEngine.fetchTableWindow(request),
  executeAnalysis: (query) => registeredDataEngine.executeAnalysis(query),
  subscribeWorkspace: (listener) => workspaceStore.subscribe(listener),
});

createRoot(container).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
);
