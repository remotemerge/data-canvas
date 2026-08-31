import { useState } from 'react';
import { Button } from '@/ui/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/ui/components/ui/dialog.tsx';

// Reloads the tab to return to an empty in-memory workspace.
const resetWorkspace = (): void => {
  window.location.reload();
};

export const ResetWorkspaceDialog = (): React.JSX.Element => {
  // Disable repeated clicks while the reload is pending.
  const [resetting, setResetting] = useState(false);
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Reset workspace</DialogTrigger>
      <DialogContent>
        <DialogTitle>Reset this workspace?</DialogTitle>
        <DialogDescription>
          This clears every imported dataset, visualization, filter, and annotation. Data Canvas keeps nothing after a
          reload, so this cannot be undone.
        </DialogDescription>
        <div className="workspace__dialog-actions">
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={resetting}
            onClick={() => {
              setResetting(true);
              resetWorkspace();
            }}
          >
            {resetting ? 'Resetting…' : 'Reset workspace'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
