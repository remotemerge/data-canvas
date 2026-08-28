import { describe, expect, test } from 'bun:test';

/**
 * The data-engine containment guard.
 *
 * DuckDB-Wasm may be imported only by the engine adapter. The rule exists because a connection
 * object reaching a React component or a WebMCP handler would let that caller run SQL of its own
 * choosing, bypassing the compiler that makes "no agent SQL" structural rather than a policy.
 *
 * Enforced here rather than in lint config, which is owned by the maintainer and stays as authored.
 */

const ENGINE_PACKAGE = '@duckdb/duckdb-wasm';

/** The only directory allowed to know DuckDB exists. */
const ENGINE_DIRECTORY = 'src/data/duckdb/';

/** Matches static imports, type-only imports, re-exports, and dynamic `import()` calls. */
const SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

const collectSpecifiers = (source: string): string[] =>
  [...source.matchAll(SPECIFIER_PATTERN)].map(([, specifier]) => specifier ?? '');

/** Bans the package root and any subpath, including the `?url` asset imports the bootstrap uses. */
const importsEngine = (specifier: string): boolean =>
  specifier === ENGINE_PACKAGE || specifier.startsWith(`${ENGINE_PACKAGE}/`);

const scan = async (glob: string): Promise<[string, string][]> => {
  const files = [...new Bun.Glob(glob).scanSync('.')];

  return Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as const)) as Promise<
    [string, string][]
  >;
};

describe('data engine boundary', () => {
  test('DuckDB-Wasm is imported only under src/data/duckdb', async () => {
    const sources = await scan('src/**/*.{ts,tsx}');

    // A trivially empty glob would make this test vacuously pass.
    expect(sources.length).toBeGreaterThan(0);

    const violations = sources
      .filter(([file]) => !file.startsWith(ENGINE_DIRECTORY))
      .filter(([, source]) => collectSpecifiers(source).some(importsEngine))
      .map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('the engine adapter genuinely holds the dependency', async () => {
    // Without this the first test would pass simply because nothing imports DuckDB at all, which
    // would make the boundary meaningless rather than enforced.
    const sources = await scan(`${ENGINE_DIRECTORY}**/*.ts`);
    const importers = sources.filter(([, source]) => collectSpecifiers(source).some(importsEngine));

    expect(importers.length).toBeGreaterThan(0);
  });

  test('no connection or engine module escapes into the UI', async () => {
    // The port is the UI's entire vocabulary for the engine. Importing the concrete engine would
    // also drag a Wasm worker into the render path.
    const sources = await scan('src/ui/**/*.{ts,tsx}');

    expect(sources.length).toBeGreaterThan(0);

    const violations = sources
      .filter(([, source]) => collectSpecifiers(source).some((specifier) => specifier.includes('data/duckdb/')))
      .map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('SQL identifiers are quoted only through identifier-safety', async () => {
    // Every SQL string in the application must obtain identifiers from one module. A relation or
    // column name interpolated directly would defeat the allowlist that keeps hostile filenames
    // and headers out of SQL.
    //
    // Scoped to files that actually emit SQL. A double-quote before a template placeholder is only
    // a hand-quoted identifier in that context; elsewhere it is ordinary quoted text — CSV fields
    // and JSON both legitimately contain it.
    const sources = await scan('src/**/*.{ts,tsx}');
    const violations = sources
      .filter(([file]) => file !== 'src/data/duckdb/identifier-safety.ts')
      .filter(([, source]) => /\b(?:SELECT|CREATE|DESCRIBE|DROP|INSERT|UPDATE|DELETE)\b/.test(source))
      .filter(([, source]) => /"\$\{/.test(source))
      .map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('the SQL-emitting files are the ones the identifier rule scopes to', async () => {
    // Without this, the rule above would pass vacuously if the SQL ever moved somewhere the
    // keyword filter no longer matches.
    const sources = await scan('src/**/*.{ts,tsx}');
    const sqlFiles = sources
      .filter(([, source]) => /\b(?:SELECT|CREATE TABLE|DESCRIBE)\b/.test(source))
      .map(([file]) => file);

    expect(sqlFiles).toEqual(['src/data/duckdb/data-engine.ts']);
  });
});
