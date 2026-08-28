import { useMemo, useState } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectDatasets, selectRevision, selectWorkspaceName } from '@/state/selectors/workspace-selectors.ts';
import { ActionErrorBanner } from '@/ui/components/action-error-banner.tsx';
import { ActionHistoryPanel } from '@/ui/workspace/action-history-panel.tsx';
import { CanvasDensityControl } from '@/ui/workspace/canvas-density-control.tsx';

/**
 * The workspace shell.
 *
 * XSS constraint. Every dataset-derived string in this subtree renders as plain text. Never add
 * `dangerouslySetInnerHTML` anywhere under `src/ui/`, because imported cell values and
 * agent-authored annotation text both flow through these components.
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
      </header>

      <div className="workspace__body">
        <aside className="workspace__panel">
          <h2 className="workspace__panel-heading">Datasets</h2>
          {datasetList.length === 0 ? (
            <p className="workspace__empty">No datasets yet.</p>
          ) : (
            <ul>
              {datasetList.map((dataset) => (
                <li key={dataset.id}>{dataset.name}</li>
              ))}
            </ul>
          )}

          <CanvasDensityControl onError={setActionError} />
        </aside>

        <main className="workspace__canvas">
          <ActionErrorBanner error={actionError} onDismiss={() => setActionError(null)} />

          <div className="workspace__empty">
            <p className="workspace__empty-title">Nothing on the canvas yet</p>
            <p>Dataset import and visualizations arrive in later plans.</p>
          </div>
        </main>

        <aside className="workspace__panel workspace__panel--right">
          <ActionHistoryPanel />
        </aside>
      </div>
    </div>
  );
};
