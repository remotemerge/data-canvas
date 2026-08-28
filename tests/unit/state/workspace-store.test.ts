import { afterEach, describe, expect, test } from 'bun:test';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import { getWorkspace, workspaceStore } from '@/state/workspace-store.ts';
import {
  selectActiveDataset,
  selectDatasets,
  selectRevision,
  selectWorkspaceName,
} from '@/state/selectors/workspace-selectors.ts';

const initialState = workspaceStore.getState();

afterEach(() => {
  workspaceStore.setState(initialState, true);
});

describe('workspaceStore', () => {
  test('initializes with an empty workspace at revision 0', () => {
    expect(getWorkspace().revision).toBe(0);
    expect(Object.keys(getWorkspace().datasets)).toHaveLength(0);
  });

  test('getWorkspace reads the same object the store holds', () => {
    expect(getWorkspace()).toBe(workspaceStore.getState().workspace);
  });

  test('notifies subscribers when state changes', () => {
    const seen: number[] = [];
    const unsubscribe = workspaceStore.subscribe((state) => seen.push(state.workspace.revision));

    workspaceStore.setState({ workspace: { ...getWorkspace(), revision: 1 } });
    workspaceStore.setState({ workspace: { ...getWorkspace(), revision: 2 } });
    unsubscribe();
    workspaceStore.setState({ workspace: { ...getWorkspace(), revision: 3 } });

    // The listener stops firing after unsubscribe, so revision 3 is absent.
    expect(seen).toEqual([1, 2]);
  });

  test('does not notify subscribers after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = workspaceStore.subscribe(() => {
      calls += 1;
    });

    unsubscribe();
    workspaceStore.setState({ workspace: { ...getWorkspace(), revision: 9 } });

    expect(calls).toBe(0);
  });
});

describe('workspace selectors', () => {
  test('read scalar workspace fields', () => {
    const workspace = createEmptyWorkspace('Sales review');
    workspaceStore.setState({ workspace });

    expect(selectWorkspaceName(workspaceStore.getState())).toBe('Sales review');
    expect(selectRevision(workspaceStore.getState())).toBe(0);
  });

  test('selectDatasets is referentially stable across reads', () => {
    // Stability matters because useStore consumers re-render whenever a selector returns a
    // new reference.
    expect(selectDatasets(workspaceStore.getState())).toBe(selectDatasets(workspaceStore.getState()));
  });

  test('selectActiveDataset is undefined when no dataset is active', () => {
    expect(selectActiveDataset(workspaceStore.getState())).toBeUndefined();
  });

  test('selectActiveDataset is undefined when activeDatasetId references a missing dataset', () => {
    workspaceStore.setState({ workspace: { ...createEmptyWorkspace(), activeDatasetId: 'ds_missing' } });

    expect(selectActiveDataset(workspaceStore.getState())).toBeUndefined();
  });
});
