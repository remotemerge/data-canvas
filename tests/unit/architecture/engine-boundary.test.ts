import { describe, expect, test } from 'bun:test';

// Guards DuckDB containment and SQL identifier boundaries.

const ENGINE_PACKAGE = '@duckdb/duckdb-wasm';

// Engine adapter directory.
const ENGINE_DIRECTORY = 'src/data/duckdb/';

// Matches import and re-export forms.
const SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

const collectSpecifiers = (source: string): string[] =>
  [...source.matchAll(SPECIFIER_PATTERN)].map(([, specifier]) => specifier ?? '');

// Disallowed DuckDB package paths.
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
    // Ensure the test does not pass vacuously when no source imports DuckDB.
    const sources = await scan(`${ENGINE_DIRECTORY}**/*.ts`);
    const importers = sources.filter(([, source]) => collectSpecifiers(source).some(importsEngine));

    expect(importers.length).toBeGreaterThan(0);
  });

  test('no connection or engine module escapes into the UI', async () => {
    // Keep the engine port as the UI's only engine vocabulary.
    const sources = await scan('src/ui/**/*.{ts,tsx}');

    expect(sources.length).toBeGreaterThan(0);

    const violations = sources
      .filter(([, source]) => collectSpecifiers(source).some((specifier) => specifier.includes('data/duckdb/')))
      .map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('SQL identifiers are quoted only through identifier-safety', async () => {
    // SQL identifiers must come from the allowlisted identifier module.
    const sources = await scan('src/**/*.{ts,tsx}');
    const violations = sources
      .filter(([file]) => file !== 'src/data/duckdb/identifier-safety.ts')
      .filter(([, source]) => /\b(?:SELECT|CREATE|DESCRIBE|DROP|INSERT|UPDATE|DELETE)\b/.test(source))
      .filter(([, source]) => /"\$\{/.test(source))
      .map(([file]) => file);

    expect(violations).toEqual([]);
  });

  test('the SQL-emitting files are the ones the identifier rule scopes to', async () => {
    // Ensure the SQL scan has not become vacuous.
    const sources = await scan('src/**/*.{ts,tsx}');
    const sqlFiles = sources
      .filter(([, source]) => /\b(?:SELECT|CREATE TABLE|DESCRIBE)\b/.test(source))
      .map(([file]) => file);

    expect(sqlFiles.toSorted()).toEqual(
      [
        'src/data/compiler/compile-analysis-query.ts',
        'src/data/compiler/compile-derived-expression.ts',
        'src/data/compiler/compile-time-spine.ts',
        'src/data/duckdb/data-engine.ts',
      ].toSorted(),
    );
  });
});
