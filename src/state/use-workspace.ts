import { useStore } from 'zustand';
import { workspaceStore, type WorkspaceState } from '@/state/workspace-store.ts';

// Bridge from the vanilla store to React.
export const useWorkspace = <T>(selector: (state: WorkspaceState) => T): T => useStore(workspaceStore, selector);
