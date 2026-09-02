import { useStore } from 'zustand';
import { workspaceStore, type WorkspaceState } from '@/state/workspace-store.ts';

export const useWorkspace = <T>(selector: (state: WorkspaceState) => T): T => useStore(workspaceStore, selector);
