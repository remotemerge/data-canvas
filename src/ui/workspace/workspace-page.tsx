import { LuDatabase, LuPanelRight } from 'react-icons/lu';
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
import { WorkspaceCanvas } from '@/ui/canvas/workspace-canvas.tsx';
import { AgentStatusIndicator } from '@/ui/workspace/agent-status-indicator.tsx';
import { SettingsSheet } from '@/ui/workspace/settings-sheet.tsx';
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
    <ActionHistoryPanel />
    <h2 className="workspace__panel-heading">Inspector</h2>
    {activeDataset === undefined ? (
      <p className="workspace__empty">Select a dataset or visualization to edit its properties.</p>
    ) : (
      <>
        <DerivedColumnEditor dataset={activeDataset} onError={onError} />
        <FilterPanel dataset={activeDataset} onError={onError} />
      </>
    )}
  </div>
);

/**
 * Workspace shell.
 *
 * Dataset-derived strings render as text. Mutations go through the shared dispatcher used by WebMCP.
 */
export const WorkspacePage = (): React.JSX.Element => {
  const name = useWorkspace(selectWorkspaceName);
  const revision = useWorkspace(selectRevision);
  const activeDataset = useWorkspace(selectActiveDataset);
  const hasVisualizations = useWorkspace(selectHasVisualizations);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const compact = useMediaQuery('(max-width: 479px)');

  // Keep rejected-action errors local; they are not workspace state.
  const [actionError, setActionError] = useState<DomainError | null>(null);

  return (
    <div className="workspace">
      <header className="workspace__header">
        <div className="workspace__identity">
          {narrow ? (
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" className="workspace__panel-trigger" aria-label="Open datasets" />
                }
              >
                <LuDatabase size={16} aria-hidden="true" />
                <span className="workspace__panel-trigger__label">Data</span>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetTitle>Dataset explorer</SheetTitle>
                <DatasetExplorer activeDataset={activeDataset} onError={setActionError} />
              </SheetContent>
            </Sheet>
          ) : null}
          <img src="/icon.svg" alt="" className="workspace__brand-icon" />
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
          <SettingsSheet onError={setActionError} showHistoryControls={compact} />
          {narrow ? (
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="workspace__panel-trigger"
                    aria-label="Open inspector"
                  />
                }
              >
                <LuPanelRight size={16} aria-hidden="true" />
                <span className="workspace__panel-trigger__label">Inspector</span>
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
              {/* The import button carries the supported-format hint, so the empty state does not repeat it. */}
              <DatasetImportButton onError={setActionError} />
            </div>
          ) : (
            <>
              {/* The table fills remaining space when no chart exists. */}
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
