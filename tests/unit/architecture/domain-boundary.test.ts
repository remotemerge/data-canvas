import { describe, expect, test } from 'bun:test';

/**
 * Defense in depth for the domain boundary.
 *
 * `oxlint.config.ts` already bans these specifiers under `src/domain/**` via `no-restricted-imports`.
 * This test re-checks the same invariant independently, so the boundary still breaks the build if
 * the lint override is edited away, renamed, or silenced with a disable comment.
 */
const BANNED_SPECIFIERS = [
  'react',
  'react-dom',
  'react-router-dom',
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
});
