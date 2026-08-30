import { LuSettings } from 'react-icons/lu';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet.tsx';
import { CanvasDensityControl } from '@/ui/workspace/canvas-density-control.tsx';
import { ResetWorkspaceDialog } from '@/ui/workspace/reset-workspace-dialog.tsx';
import { UndoRedoControls } from '@/ui/workspace/undo-redo-controls.tsx';

interface SettingsSheetProps {
  onError: (error: DomainError | null) => void;
  /** Undo and redo live here only at widths where the header cannot show them. */
  showHistoryControls: boolean;
}

/**
 * Workspace-level settings.
 *
 * These belong here rather than in the inspector: the inspector edits whatever is selected, while
 * density, storage, and the privacy notice apply to the workspace no matter what is selected. Left
 * in the right rail they pushed the per-dataset editors down and were read once and then ignored.
 */
export const SettingsSheet = ({ onError, showHistoryControls }: SettingsSheetProps): React.JSX.Element => (
  <Sheet>
    <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open settings" />}>
      <LuSettings size={16} aria-hidden="true" />
    </SheetTrigger>
    <SheetContent side="right">
      <SheetTitle>Settings</SheetTitle>
      <div className="settings">
        {showHistoryControls ? (
          <div className="workspace__mobile-actions">
            <UndoRedoControls onError={onError} />
          </div>
        ) : null}

        <CanvasDensityControl onError={onError} />

        <section aria-labelledby="settings-data-title">
          <h2 id="settings-data-title" className="workspace__panel-heading">
            Workspace data
          </h2>
          <p>Datasets and charts are stored in this browser on this device, and are not backed up.</p>
          <ResetWorkspaceDialog />
        </section>

        <section className="privacy-notice" aria-labelledby="settings-privacy-title">
          <h2 id="settings-privacy-title" className="workspace__panel-heading">
            Privacy
          </h2>
          <p>Imported data stays in DuckDB-Wasm in this browser.</p>
          <p>Data returned through WebMCP may be processed by the AI agent you use.</p>
        </section>
      </div>
    </SheetContent>
  </Sheet>
);
