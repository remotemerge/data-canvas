import { describe, expect, test } from 'bun:test';

// Guards the single workspace mutation path.

// Modules allowed to write state.
const MUTATION_ALLOWLIST = [
  'src/state/workspace-store.ts',
  'src/application/actions/dispatcher.ts',
  'src/state/engine-status.ts',
];

const SET_STATE_PATTERN = /\bsetState\s*\(/;

// Glob scanning yields backslash separators on Windows, so paths are normalized
// before any comparison against the forward-slash allowlist entries.
const scan = async (glob: string): Promise<[string, string][]> => {
  const files = [...new Bun.Glob(glob).scanSync('.')];

  return Promise.all(
    files.map(async (file) => [file.replaceAll('\\', '/'), await Bun.file(file).text()] as const),
  ) as Promise<[string, string][]>;
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
    // Components read through useWorkspace and write through useActions.
    const sources = await scan('src/ui/**/*.{ts,tsx}');

    expect(sources.length).toBeGreaterThan(0);

    const violations = sources.filter(([, source]) => source.includes('workspace-store')).map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('the allowlisted files are the ones that genuinely need a store write', async () => {
    // Keep exemptions limited to current state writers.
    const sources = await Promise.all(MUTATION_ALLOWLIST.map((file) => Bun.file(file).text()));

    for (const source of sources) {
      expect(source.length).toBeGreaterThan(0);
    }

    const dispatcher = await Bun.file('src/application/actions/dispatcher.ts').text();

    expect(SET_STATE_PATTERN.test(dispatcher)).toBe(true);
  });

  test('the engine-status exemption does not reach the workspace store', async () => {
    // A session-store module must not import the workspace store.
    const source = await Bun.file('src/state/engine-status.ts').text();

    expect(source).not.toContain('workspace-store');
    expect(source).not.toContain('dispatcher');
  });
});
