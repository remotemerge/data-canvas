import { createStore } from 'zustand/vanilla';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { createEmptyWorkspace, type Workspace } from '@/domain/workspace/workspace.ts';

export interface WorkspaceState {
  workspace: Workspace;
  history: ActionHistoryEntry[];
  undoStack: string[];
  redoStack: string[];
}

// Canonical vanilla Zustand workspace store used by React, services, and WebMCP.
export const workspaceStore = createStore<WorkspaceState>()(() => ({
  workspace: createEmptyWorkspace(),
  history: [],
  undoStack: [],
  redoStack: [],
}));

export const getWorkspace = (): Workspace => workspaceStore.getState().workspace;
