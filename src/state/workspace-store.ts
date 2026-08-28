import { createStore } from 'zustand/vanilla';
import { createEmptyWorkspace, type Workspace } from '@/domain/workspace/workspace.ts';

export interface WorkspaceState {
  workspace: Workspace;
}

/**
 * The canonical workspace store.
 *
 * Uses Zustand's vanilla `createStore`, not the React `create`, because WebMCP tool handlers and
 * application services must reach state without a React tree. React attaches to this store through
 * `useWorkspace`.
 *
 * Only the application layer's action dispatcher may call `setState`. React components and WebMCP
 * handlers never call it directly. That restriction is what stops the human and agent execution
 * paths from diverging.
 *
 * No `persist` middleware here by design. Durable storage targets OPFS, and adding localStorage
 * persistence now would leave the workspace with two competing sources of truth.
 */
export const workspaceStore = createStore<WorkspaceState>()(() => ({
  workspace: createEmptyWorkspace(),
}));

/** Narrow read accessor for non-React consumers (services, WebMCP adapter, tests). */
export const getWorkspace = (): Workspace => workspaceStore.getState().workspace;
