import { describe, expect, test } from 'bun:test';

/**
 * The domain boundary guard.
 *
 * This test is the sole enforcement of the rule. The shared `oxlint.config.ts` stays as authored and
 * carries no path-scoped `no-restricted-imports` override, so nothing else catches a leaked adapter
 * import. Keep this test passing rather than relaxing it.
 */
const BANNED_SPECIFIERS = [
  'react',
  'react-dom',
  'echarts',
  '@tanstack/react-table',
  '@tanstack/react-virtual',
  '@duckdb/duckdb-wasm',
  'zustand',
  '@mcp-b/webmcp-types',
];

/** Bans the package root and any subpath (`echarts/core`), but not lookalikes (`react-icons`). */
const isBanned = (specifier: string): boolean =>
  BANNED_SPECIFIERS.some((banned) => specifier === banned || specifier.startsWith(`${banned}/`));

/** Matches static imports, type-only imports, re-exports, and dynamic `import()` calls. */
const SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

const collectSpecifiers = (source: string): string[] =>
  [...source.matchAll(SPECIFIER_PATTERN)].map(([, specifier]) => specifier ?? '');

describe('domain boundary', () => {
  test('no file under src/domain imports an adapter dependency', async () => {
    const files = [...new Bun.Glob('src/domain/**/*.ts').scanSync('.')];

    // A trivially empty glob would make this test vacuously pass.
    expect(files.length).toBeGreaterThan(0);

    const sources = await Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as const));

    const violations = sources.flatMap(([file, source]) =>
      collectSpecifiers(source)
        .filter(isBanned)
        .map((specifier) => `${file} imports ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  test('the banned-specifier matcher is exact rather than substring-based', () => {
    expect(isBanned('react')).toBe(true);
    expect(isBanned('react-dom/client')).toBe(true);
    expect(isBanned('echarts/core')).toBe(true);
    expect(isBanned('react-icons')).toBe(false);
    expect(isBanned('@/domain/dataset/dataset.ts')).toBe(false);
  });

  test('specifier extraction finds every import form', () => {
    const source = [
      "import { a } from 'react';",
      "import type { B } from '@/domain/x.ts';",
      "export { c } from 'zustand';",
      "const d = await import('echarts');",
    ].join('\n');

    expect(collectSpecifiers(source)).toEqual(['react', '@/domain/x.ts', 'zustand', 'echarts']);
  });

  test('ECharts imports stay inside the visualization adapter', async () => {
    const files = [...new Bun.Glob('src/**/*.{ts,tsx}').scanSync('.')].filter(
      (file) => !file.startsWith('src/visualization/'),
    );
    const sources = await Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as const));
    const violations = sources.flatMap(([file, source]) =>
      collectSpecifiers(source)
        .filter((specifier) => specifier === 'echarts' || specifier.startsWith('echarts/'))
        .map((specifier) => `${file} imports ${specifier}`),
    );

    expect(violations).toEqual([]);
  });
});
const imports = (source: string): string[] =>
  [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] ?? '',
  );

const sourceFiles = async (pattern: string): Promise<{ path: string; source: string }[]> => {
  const files: { path: string; source: string }[] = [];
  for await (const path of new Bun.Glob(pattern).scan('.')) files.push({ path, source: await Bun.file(path).text() });
  return files;
};

describe('WebMCP boundaries', () => {
  test('WebMCP handlers cannot import the store or DuckDB engine', async () => {
    for (const file of await sourceFiles('src/webmcp/**/*.{ts,tsx}')) {
      const specifiers = imports(file.source);
      expect(specifiers, file.path).not.toContain('@/state/workspace-store.ts');
      expect(specifiers, file.path).not.toContain('@/data/duckdb/data-engine.ts');
    }
  });

  test('domain modules cannot import WebMCP types', async () => {
    for (const file of await sourceFiles('src/domain/**/*.ts')) {
      expect(imports(file.source), file.path).not.toContain('@mcp-b/webmcp-types');
    }
  });
});
