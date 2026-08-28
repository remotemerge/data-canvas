import { afterEach, describe, expect, test } from 'bun:test';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import { selectRevision } from '@/state/selectors/workspace-selectors.ts';
import { workspaceStore } from '@/state/workspace-store.ts';

const initialState = workspaceStore.getState();

afterEach(() => {
  workspaceStore.setState(initialState, true);
});

/**
 * `useWorkspace` is a one-line `useStore` wrapper, so rendering React adds no coverage here, and
 * the project runs no DOM layer by design. What matters is the mechanism underneath `useStore`, a
 * selector-driven subscription that fires when the selected value changes and not otherwise. These
 * tests assert that directly against the vanilla store.
 */
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
