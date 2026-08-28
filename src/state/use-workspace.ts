import { useStore } from 'zustand';
import { workspaceStore, type WorkspaceState } from '@/state/workspace-store.ts';

/**
 * The single bridge between the vanilla store and React. No component subscribes any other way.
 * One subscription path keeps the store's mutation rules enforceable.
 */
export const useWorkspace = <T>(selector: (state: WorkspaceState) => T): T => useStore(workspaceStore, selector);
