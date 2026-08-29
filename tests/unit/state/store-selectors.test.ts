import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * Guards against unstable Zustand selectors.
 *
 * A selector that builds a new array or object on every call — `state.x.filter(...)`,
 * `Object.values(state.x).filter(...)` — makes `useSyncExternalStore` see a changed snapshot on
 * every render. React then re-renders forever and throws "Maximum update depth exceeded".
 *
 * This is not hypothetical. `Provenance` filtered the history array inside its selector, and because
 * it renders inside every chart panel and metric card, the loop took down the whole canvas the first
 * time a chart was created against a real dataset. Unit tests did not catch it because the crash
 * only appears once a component actually subscribes and re-renders.
 *
 * The rule: select the stable reference, derive with `useMemo`.
 */

/** Selector bodies that allocate. `find` is excluded: it returns an element, not a new container. */
const ALLOCATING_CALL = /\.(filter|map|flatMap|slice|concat|toSorted|toReversed|sort)\s*\(/u;

/**
 * Extracts each `useWorkspace((state) => …)` selector body by matching parentheses.
 *
 * A regex cannot do this correctly — a selector body contains its own parens — so the opening call
 * is found by pattern and the body is then scanned to its balanced close.
 */
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

      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;

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
