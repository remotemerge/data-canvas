import { LuDatabase, LuEllipsis, LuPanelRight } from 'react-icons/lu';
import { useState } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import {
  selectActiveDataset,
  selectHasVisualizations,
  selectRevision,
  selectWorkspaceName,
} from '@/state/selectors/workspace-selectors.ts';
import { ActionErrorBanner } from '@/ui/components/action-error-banner.tsx';
import { EngineStatusBanner } from '@/ui/components/engine-status-banner.tsx';
import { DatasetImportButton } from '@/ui/dataset/dataset-import-button.tsx';
import { DataPanel } from '@/ui/workspace/data-panel.tsx';
import { FilterPanel } from '@/ui/dataset/filter-panel.tsx';
import { DatasetList } from '@/ui/dataset/dataset-list.tsx';
import { DatasetSchemaPanel } from '@/ui/dataset/dataset-schema-panel.tsx';
import { DerivedColumnEditor } from '@/ui/dataset/derived-column-editor.tsx';
import { RelationshipEditor } from '@/ui/dataset/relationship-editor.tsx';
import { RelationshipGraph } from '@/ui/dataset/relationship-graph.tsx';
import { ActionHistoryPanel } from '@/ui/workspace/action-history-panel.tsx';
import { SelectionSummary } from '@/ui/workspace/selection-summary.tsx';
import { UpdatePrompt } from '@/ui/components/update-prompt.tsx';
import { CanvasDensityControl } from '@/ui/workspace/canvas-density-control.tsx';
import { WorkspaceCanvas } from '@/ui/canvas/workspace-canvas.tsx';
import { AgentStatusIndicator } from '@/ui/workspace/agent-status-indicator.tsx';
import { StoragePanel } from '@/ui/workspace/storage-panel.tsx';
import { UndoRedoControls } from '@/ui/workspace/undo-redo-controls.tsx';
import { Button } from '@/ui/components/ui/button.tsx';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet.tsx';
import { ThemeToggle } from '@/ui/workspace/theme-toggle.tsx';
import { useMediaQuery } from '@/shared/use-media-query.ts';

interface PanelProps {
  activeDataset: ReturnType<typeof selectActiveDataset>;
  onError(error: DomainError | null): void;
}

const DatasetExplorer = ({ activeDataset, onError }: PanelProps): React.JSX.Element => (
  <div className="workspace__panel-content">
    <div className="workspace__panel-title-row">
      <h2 className="workspace__panel-heading">Datasets</h2>
      <LuDatabase size={15} aria-hidden="true" />
    </div>
    <DatasetImportButton onError={onError} emphasis="secondary" />
    <DatasetList onError={onError} />
    <section>
      <h2 className="workspace__panel-heading">Columns</h2>
      <DatasetSchemaPanel dataset={activeDataset} />
    </section>
    <RelationshipEditor onError={onError} />
    <RelationshipGraph onError={onError} />
  </div>
);

const Inspector = ({ activeDataset, onError }: PanelProps): React.JSX.Element => (
  <div className="workspace__panel-content">
    <h2 className="workspace__panel-heading">Inspector</h2>
    {activeDataset === undefined ? (
      <p className="workspace__empty">Select a dataset or visualization to edit its properties.</p>
    ) : (
      <>
        <DerivedColumnEditor dataset={activeDataset} onError={onError} />
        <FilterPanel dataset={activeDataset} onError={onError} />
      </>
    )}
    <CanvasDensityControl onError={onError} />
    <ActionHistoryPanel />
    <StoragePanel />
    <section className="privacy-notice" aria-labelledby="privacy-notice-title">
      <h2 id="privacy-notice-title" className="workspace__panel-heading">
        Privacy
      </h2>
      <p>Imported data stays in DuckDB-Wasm in this browser.</p>
      <p>Data returned through WebMCP may be processed by the AI agent you use.</p>
    </section>
  </div>
);

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
  const activeDataset = useWorkspace(selectActiveDataset);
  const hasVisualizations = useWorkspace(selectHasVisualizations);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const compact = useMediaQuery('(max-width: 479px)');

  // The most recent dispatch failure. Held locally rather than in the store: a rejected action is
  // this view's transient concern, not shared workspace state.
  const [actionError, setActionError] = useState<DomainError | null>(null);

  return (
    <div className="workspace">
      <header className="workspace__header">
        <div className="workspace__identity">
          {narrow ? (
            <Sheet>
              <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open datasets" />}>
                <LuDatabase size={16} aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="left">
                <SheetTitle>Dataset explorer</SheetTitle>
                <DatasetExplorer activeDataset={activeDataset} onError={setActionError} />
              </SheetContent>
            </Sheet>
          ) : null}
          <span className="workspace__brand">Data Canvas</span>
          <h1 className="workspace__title">{name}</h1>
          <span className="workspace__revision" aria-label={`Workspace revision ${revision}`}>
            r{revision}
          </span>
        </div>
        <div className="workspace__header-status">
          <AgentStatusIndicator />
          <SelectionSummary onError={setActionError} />
        </div>
        <div className="workspace__actions">
          {compact ? null : <UndoRedoControls onError={setActionError} />}
          <ThemeToggle />
          {compact ? (
            <Sheet>
              <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open workspace options" />}>
                <LuEllipsis size={16} aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="right">
                <SheetTitle>Workspace options</SheetTitle>
                <div className="workspace__mobile-actions">
                  <UndoRedoControls onError={setActionError} />
                </div>
              </SheetContent>
            </Sheet>
          ) : null}
          {narrow ? (
            <Sheet>
              <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open inspector" />}>
                <LuPanelRight size={16} aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="right">
                <SheetTitle>Inspector</SheetTitle>
                <Inspector activeDataset={activeDataset} onError={setActionError} />
              </SheetContent>
            </Sheet>
          ) : null}
        </div>
      </header>

      <UpdatePrompt />

      <div className="workspace__body">
        {narrow ? null : (
          <aside className="workspace__panel">
            <DatasetExplorer activeDataset={activeDataset} onError={setActionError} />
          </aside>
        )}

        <main className="workspace__canvas">
          <EngineStatusBanner />
          <ActionErrorBanner error={actionError} onDismiss={() => setActionError(null)} />

          {activeDataset === undefined ? (
            <div className="workspace__empty">
              <LuDatabase className="workspace__empty-icon" size={28} aria-hidden="true" />
              <p className="workspace__empty-title">Import a dataset</p>
              <p>CSV, TSV, JSON, and NDJSON are supported.</p>
              <DatasetImportButton onError={setActionError} />
            </div>
          ) : (
            <>
              {/* An empty canvas is a builder and a one-line placeholder, so it takes only the
                  height it needs and the data panel grows into the rest. Reserving chart space for
                  charts that do not exist would push the table into a strip for nothing. */}
              <div className="workspace__views" data-empty={!hasVisualizations}>
                <WorkspaceCanvas onError={setActionError} />
              </div>
              <DataPanel dataset={activeDataset} fills={!hasVisualizations} />
            </>
          )}
        </main>

        {narrow ? null : (
          <aside className="workspace__panel workspace__panel--right">
            <Inspector activeDataset={activeDataset} onError={setActionError} />
          </aside>
        )}
      </div>
    </div>
  );
};
