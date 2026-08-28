import { useMemo } from 'react';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectDatasets, selectRevision, selectWorkspaceName } from '@/state/selectors/workspace-selectors.ts';

/**
 * The workspace shell.
 *
 * XSS constraint. Every dataset-derived string in this subtree renders as plain text. Never add
 * `dangerouslySetInnerHTML` anywhere under `src/ui/`, because imported cell values and
 * agent-authored annotation text both flow through these components.
 *
 * The header shows the revision counter on purpose. It makes the optimistic-concurrency model
 * observable when a human and an agent edit the workspace at the same time.
 */
export const WorkspacePage = (): React.JSX.Element => {
  const name = useWorkspace(selectWorkspaceName);
  const revision = useWorkspace(selectRevision);
  const datasets = useWorkspace(selectDatasets);

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
        </aside>

        <main className="workspace__canvas">
          <div className="workspace__empty">
            <p className="workspace__empty-title">Nothing on the canvas yet</p>
            <p>Dataset import and visualizations arrive in later plans.</p>
          </div>
        </main>
      </div>
    </div>
  );
};
