import { useMemo, useState } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import {
  selectActiveDataset,
  selectDatasets,
  selectRevision,
  selectWorkspaceName,
} from '@/state/selectors/workspace-selectors.ts';
import { ActionErrorBanner } from '@/ui/components/action-error-banner.tsx';
import { EngineStatusBanner } from '@/ui/components/engine-status-banner.tsx';
import { DatasetImportButton } from '@/ui/dataset/dataset-import-button.tsx';
import { WorkspaceTable } from '@/table/tanstack/workspace-table.tsx';
import { FilterPanel } from '@/ui/dataset/filter-panel.tsx';
import { DatasetSchemaPanel } from '@/ui/dataset/dataset-schema-panel.tsx';
import { ActionHistoryPanel } from '@/ui/workspace/action-history-panel.tsx';
import { CanvasDensityControl } from '@/ui/workspace/canvas-density-control.tsx';
import { WorkspaceCanvas } from '@/ui/canvas/workspace-canvas.tsx';
import { AgentStatusIndicator } from '@/ui/workspace/agent-status-indicator.tsx';
import { StoragePanel } from '@/ui/workspace/storage-panel.tsx';

/**
 * The workspace shell.
 *
 * XSS constraint. Every dataset-derived string in this subtree renders as plain text. Never add
 * `dangerouslySetInnerHTML` anywhere under `src/ui/`, because imported cell values, column headers,
 * filenames, and agent-authored annotation text all flow through these components.
 *
 * The header shows the revision counter on purpose. It makes the optimistic-concurrency model
 * observable when a human and an agent edit the workspace at the same time.
 *
 * No component here mutates the store. Every change goes through `useActions`, the same dispatcher
 * the WebMCP adapter calls.
 */
export const WorkspacePage = (): React.JSX.Element => {
  const name = useWorkspace(selectWorkspaceName);
  const revision = useWorkspace(selectRevision);
  const datasets = useWorkspace(selectDatasets);
  const activeDataset = useWorkspace(selectActiveDataset);

  // The most recent dispatch failure. Held locally rather than in the store: a rejected action is
  // this view's transient concern, not shared workspace state.
  const [actionError, setActionError] = useState<DomainError | null>(null);

  // Selectors stay referentially stable by returning the stored record; arrays are derived here.
  const datasetList = useMemo(() => Object.values(datasets), [datasets]);

  return (
    <div className="workspace">
      <header className="workspace__header">
        <h1 className="workspace__title">{name}</h1>
        <span className="workspace__revision">revision {revision}</span>
        <AgentStatusIndicator />
      </header>

      <div className="workspace__body">
        <aside className="workspace__panel">
          <h2 className="workspace__panel-heading">Datasets</h2>

          <DatasetImportButton onError={setActionError} />

          {datasetList.length === 0 ? (
            <p className="workspace__empty">No datasets yet.</p>
          ) : (
            <ul className="dataset-list">
              {datasetList.map((dataset) => (
                <li key={dataset.id} className="dataset-list__item">
                  {/* The filename is untrusted display text and renders as a text child only. */}
                  <span className="dataset-list__name">{dataset.name}</span>
                  <span className="dataset-list__status" data-status={dataset.importStatus}>
                    {dataset.importStatus}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <section>
            <h2 className="workspace__panel-heading">Schema</h2>
            <DatasetSchemaPanel dataset={activeDataset} />
          </section>

          <CanvasDensityControl onError={setActionError} />
          {activeDataset === undefined ? null : <FilterPanel dataset={activeDataset} onError={setActionError} />}
        </aside>

        <main className="workspace__canvas">
          <EngineStatusBanner />
          <ActionErrorBanner error={actionError} onDismiss={() => setActionError(null)} />

          {activeDataset === undefined ? (
            <div className="workspace__empty">
              <p className="workspace__empty-title">Nothing on the canvas yet</p>
              <p>Import a CSV or JSON file to explore its schema and rows.</p>
            </div>
          ) : (
            <>
              <WorkspaceCanvas onError={setActionError} />
              <WorkspaceTable dataset={activeDataset} />
            </>
          )}
        </main>

        <aside className="workspace__panel workspace__panel--right">
          <ActionHistoryPanel />
          <StoragePanel />
          <section className="privacy-notice" aria-labelledby="privacy-notice-title">
            <h2 id="privacy-notice-title" className="workspace__panel-heading">
              Privacy
            </h2>
            <p>Your imported data stays in DuckDB-Wasm in this browser.</p>
            <p>Data returned through WebMCP is sent to the AI agent you use and may be processed in the cloud.</p>
          </section>
        </aside>
      </div>
    </div>
  );
};
