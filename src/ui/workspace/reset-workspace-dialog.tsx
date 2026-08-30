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

/**
 * Returns the tab to an empty workspace.
 *
 * A reload is the whole implementation: the analytical database is in memory and the store is
 * rebuilt from `createEmptyWorkspace`, so nothing outlives the page. There is no stored file to
 * delete.
 */
const resetWorkspace = (): void => {
  window.location.reload();
};

export const ResetWorkspaceDialog = (): React.JSX.Element => {
  // The reload is not instant with a large dataset loaded, and a second click would race the first.
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
