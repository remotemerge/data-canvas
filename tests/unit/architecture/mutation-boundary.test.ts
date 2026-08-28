import { describe, expect, test } from 'bun:test';

/**
 * The single-mutation-path guard.
 *
 * The architecture's defining property is that a human click and an agent tool call reach the same
 * validation, revision, and history behaviour. That holds only while `setState` is unreachable
 * outside the dispatcher — a component that writes the store directly would silently create the
 * second mutation path and the two surfaces would drift apart.
 *
 * Enforced here rather than in lint config, which is owned by the maintainer and stays as authored.
 */

/** Where a store write is legitimate: the store's own module and the dispatcher's commit. */
const MUTATION_ALLOWLIST = ['src/state/workspace-store.ts', 'src/application/actions/dispatcher.ts'];

const SET_STATE_PATTERN = /\bsetState\s*\(/;

const scan = async (glob: string): Promise<[string, string][]> => {
  const files = [...new Bun.Glob(glob).scanSync('.')];

  return Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as const)) as Promise<
    [string, string][]
  >;
};

describe('store mutation boundary', () => {
  test('no source file outside the dispatcher and the store itself calls setState', async () => {
    const sources = await scan('src/**/*.{ts,tsx}');

    // A trivially empty glob would make this test vacuously pass.
    expect(sources.length).toBeGreaterThan(0);

    const violations = sources
      .filter(([file]) => !MUTATION_ALLOWLIST.includes(file))
      .filter(([, source]) => SET_STATE_PATTERN.test(source))
      .map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('no React component imports the workspace store', async () => {
    // Components read through `useWorkspace` and write through `useActions`. Importing the store
    // gives a component both `getState` and `setState`, which is the escape hatch to close.
    const sources = await scan('src/ui/**/*.{ts,tsx}');

    expect(sources.length).toBeGreaterThan(0);

    const violations = sources.filter(([, source]) => source.includes('workspace-store')).map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('the allowlisted files are the ones that genuinely need a store write', async () => {
    // Guards against the allowlist rotting into a list of exemptions for files that no longer
    // write state, which would quietly widen the boundary.
    const sources = await Promise.all(MUTATION_ALLOWLIST.map((file) => Bun.file(file).text()));

    for (const source of sources) expect(source.length).toBeGreaterThan(0);

    const dispatcher = await Bun.file('src/application/actions/dispatcher.ts').text();

    expect(SET_STATE_PATTERN.test(dispatcher)).toBe(true);
  });
});
