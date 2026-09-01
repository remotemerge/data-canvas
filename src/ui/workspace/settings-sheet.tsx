import { LuSettings } from 'react-icons/lu';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet.tsx';
import { CanvasDensityControl } from '@/ui/workspace/canvas-density-control.tsx';
import { ResetWorkspaceDialog } from '@/ui/workspace/reset-workspace-dialog.tsx';
import { UndoRedoControls } from '@/ui/workspace/undo-redo-controls.tsx';

interface SettingsSheetProps {
  onError: (error: DomainError | null) => void;
  // Show undo and redo when the header is too narrow.
  showHistoryControls: boolean;
}

// Workspace-level settings shown in the settings sheet.
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
          <p>Datasets and charts stay in this browser tab until it is reloaded or closed.</p>
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
