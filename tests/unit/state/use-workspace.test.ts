import { afterEach, describe, expect, test } from 'bun:test';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import { selectRevision } from '@/state/selectors/workspace-selectors.ts';
import { workspaceStore } from '@/state/workspace-store.ts';

const initialState = workspaceStore.getState();

afterEach(() => {
  workspaceStore.setState(initialState, true);
});

// Verifies the hook's selector-driven store subscription without mounting React.
describe('store subscription path used by useWorkspace', () => {
  test('a committed revision change reaches selector subscribers', () => {
    const observed: number[] = [];

    const unsubscribe = workspaceStore.subscribe((state) => {
      observed.push(selectRevision(state));
    });

    workspaceStore.setState({ workspace: { ...createEmptyWorkspace(), revision: 1 } });
    workspaceStore.setState({ workspace: { ...createEmptyWorkspace(), revision: 2 } });
    unsubscribe();

    expect(observed).toEqual([1, 2]);
  });

  test('selector output tracks the committed workspace', () => {
    workspaceStore.setState({ workspace: { ...createEmptyWorkspace(), revision: 7 } });

    expect(selectRevision(workspaceStore.getState())).toBe(7);
  });
});
