import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import {
  selectActiveDataset,
  selectActiveDatasetId,
  selectDatasets,
  selectFilters,
  selectFiltersForDataset,
  selectHasVisualizations,
  selectHistory,
  selectLayoutColumns,
  selectRevision,
  selectTableSortForDataset,
  selectVisualizations,
  selectWorkspaceName,
} from '@/state/selectors/workspace-selectors.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';
import {
  createHarness,
  visualization as makeVisualization,
  workspaceWithDataset,
} from '../application/action-fixtures.ts';

// Guards against selectors that allocate new references on each read.

// Selector bodies that allocate new containers.
const ALLOCATING_CALL = /\.(filter|map|flatMap|slice|concat|toSorted|toReversed|sort)\s*\(/u;

// Extracts selector bodies with balanced-parenthesis scanning.
const SELECTOR_START = /useWorkspace\(\s*\((?:state|s)\)\s*=>/gu;

const selectorBodies = (source: string): string[] => {
  const bodies: string[] = [];

  SELECTOR_START.lastIndex = 0;

  for (const match of source.matchAll(SELECTOR_START)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let index = start;

    // `useWorkspace(` opened one level; the body ends where that level closes.
    while (index < source.length && depth > 0) {
      const character = source[index];

      if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }

      index += 1;
    }

    bodies.push(source.slice(start, index - 1));
  }

  return bodies;
};

const sourceFiles = async (): Promise<{ path: string; source: string }[]> => {
  const files: { path: string; source: string }[] = [];

  for (const path of new Bun.Glob('src/**/*.{ts,tsx}').scanSync('.')) {
    files.push({ path, source: readFileSync(path, 'utf8') });
  }

  return files;
};

describe('workspace selector stability', () => {
  test('no useWorkspace selector allocates a new collection', async () => {
    const files = await sourceFiles();

    expect(files.length).toBeGreaterThan(0);

    const violations = files.flatMap((file) =>
      selectorBodies(file.source)
        .filter((body) => ALLOCATING_CALL.test(body))
        .map((body) => `${file.path}: selector allocates — ${body.trim().slice(0, 90)}`),
    );

    expect(violations).toEqual([]);
  });

  test('the matcher recognizes the pattern that actually broke the canvas', () => {
    const broken = 'const e = useWorkspace((state) => state.history.filter((x) => x.id === id));';
    const fixed = 'const h = useWorkspace((state) => state.history);';

    expect(ALLOCATING_CALL.test(selectorBodies(broken)[0] ?? '')).toBe(true);
    expect(ALLOCATING_CALL.test(selectorBodies(fixed)[0] ?? '')).toBe(false);
  });

  test('body extraction stops at the selector, not at the next statement', () => {
    const source = 'const a = useWorkspace((state) => state.workspace);\nconst b = list.filter((x) => x);';

    expect(selectorBodies(source)).toEqual([' state.workspace']);
  });
});

const state = (): WorkspaceState => createHarness(workspaceWithDataset()).store.getState();

describe('workspace selectors', () => {
  test('reads the workspace name', () => {
    const current = state();

    expect(selectWorkspaceName(current)).toBe(current.workspace.name);
  });

  test('reads the workspace revision', () => {
    expect(selectRevision(state())).toBe(0);
  });

  /*
   * Returning the stored container rather than a copy is what keeps `useWorkspace` from rerendering
   * on every store read, so identity is the behavior under test.
   */
  test('returns the stored collections by reference', () => {
    const current = state();

    expect(selectDatasets(current)).toBe(current.workspace.datasets);
    expect(selectVisualizations(current)).toBe(current.workspace.visualizations);
    expect(selectFilters(current)).toBe(current.workspace.filters);
    expect(selectHistory(current)).toBe(current.history);
  });

  test('reads the layout column count', () => {
    const current = state();

    expect(selectLayoutColumns(current)).toBe(current.workspace.layout.columns);
  });

  test('reports no visualizations for an empty canvas', () => {
    expect(selectHasVisualizations(state())).toBe(false);
  });

  test('reports visualizations once the canvas holds a chart', () => {
    const workspace = workspaceWithDataset();
    const chart = makeVisualization('viz_1', 'ds_sales');
    const current = createHarness({ ...workspace, visualizations: { [chart.id]: chart } }).store.getState();

    expect(selectHasVisualizations(current)).toBe(true);
  });

  test('reports no active dataset before one is chosen', () => {
    expect(selectActiveDatasetId(state())).toBeUndefined();
    expect(selectActiveDataset(state())).toBeUndefined();
  });

  test('resolves the active dataset from its id', () => {
    const current = state();
    const active = { ...current, workspace: { ...current.workspace, activeDatasetId: 'ds_sales' } };

    expect(selectActiveDatasetId(active)).toBe('ds_sales');
    expect(selectActiveDataset(active)?.id).toBe('ds_sales');
  });

  test('an empty workspace has no active dataset', () => {
    expect(selectActiveDataset(createHarness(createEmptyWorkspace()).store.getState())).toBeUndefined();
  });

  test('a dataset with no filters yields an empty list', () => {
    expect(selectFiltersForDataset(state(), 'ds_sales')).toEqual([]);
  });

  test('a dataset with a filter yields that filter', () => {
    const workspace = workspaceWithDataset();
    const current = createHarness({
      ...workspace,
      filters: {
        filter_region: {
          id: 'filter_region',
          datasetId: 'ds_sales',
          columnId: 'col_region',
          operator: 'eq',
          value: 'West',
          enabled: true,
          origin: 'human',
          createdBy: 'human',
        },
      },
    }).store.getState();

    expect(selectFiltersForDataset(current, 'ds_sales').map((filter) => filter.id)).toEqual(['filter_region']);
  });

  test('a dataset with no stored sort yields an empty list', () => {
    expect(selectTableSortForDataset(state(), 'ds_sales')).toEqual([]);
  });

  test('an unknown dataset yields an empty sort rather than undefined', () => {
    expect(selectTableSortForDataset(state(), 'missing')).toEqual([]);
  });
});
