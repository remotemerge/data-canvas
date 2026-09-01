import { describe, expect, test } from 'bun:test';
import {
  SAFE_IDENTIFIER_PATTERN,
  createColumnName,
  createRelationName,
  isSafeIdentifier,
  quoteIdentifier,
  stagingRelationName,
  virtualImportPath,
} from '@/data/duckdb/identifier-safety.ts';

describe('createRelationName', () => {
  test('produces a generated name that never contains the filename', () => {
    const relation = createRelationName('ds_7f98c3a1-4b2e-4c1d-9a0f-1234567890ab');

    expect(relation).toBe('dataset_7f98c3a14b2e');
    expect(isSafeIdentifier(relation)).toBe(true);
  });

  test('is stable for the same dataset id', () => {
    // Re-deriving must return the existing relation name.
    const id = 'ds_7f98c3a1-4b2e-4c1d-9a0f-1234567890ab';

    expect(createRelationName(id)).toBe(createRelationName(id));
  });

  test('yields distinct names for distinct datasets', () => {
    const first = createRelationName('ds_11111111-1111-1111-1111-111111111111');
    const second = createRelationName('ds_22222222-2222-2222-2222-222222222222');

    expect(first).not.toBe(second);
  });

  test('stays within the allowlist even for an id with no hex characters', () => {
    // Short or non-hex IDs still produce a conforming identifier.
    const relation = createRelationName('ds_zzzz');

    expect(isSafeIdentifier(relation)).toBe(true);
    expect(relation).toBe('dataset_000000000000');
  });

  test('the id prefix does not bleed into the relation name', () => {
    // Drop the ds_ prefix before filtering ID characters.
    expect(createRelationName('ds_abcdef012345')).toBe('dataset_abcdef012345');
    expect(createRelationName('abcdef012345')).toBe('dataset_abcdef012345');
  });

  test('a hostile filename cannot influence the relation name', () => {
    // Filenames never enter relation-name generation.
    const relation = createRelationName('ds_abcdef01-2345-6789-abcd-ef0123456789');

    expect(relation).not.toContain('DROP');
    expect(relation).not.toContain(' ');
    expect(relation).not.toContain(';');
    expect(SAFE_IDENTIFIER_PATTERN.test(relation)).toBe(true);
  });
});

describe('stagingRelationName', () => {
  test('derives a conforming staging name', () => {
    const staging = stagingRelationName(createRelationName('ds_7f98c3a1-4b2e-4c1d-9a0f-1234567890ab'));

    expect(staging).toBe('dataset_7f98c3a14b2e_staging');
    expect(isSafeIdentifier(staging)).toBe(true);
  });
});

describe('virtualImportPath', () => {
  test('derives the path from the generated staging name', () => {
    expect(virtualImportPath('dataset_abc123_staging')).toBe('dataset_abc123_staging.import');
  });

  test('refuses a name outside the allowlist', () => {
    // Virtual paths cannot derive from filenames.
    for (const hostile of ["x'); DROP TABLE y; --", '../../etc/passwd', 'Q4 sales.csv', '']) {
      expect(() => virtualImportPath(hostile)).toThrow();
    }
  });
});

describe('createColumnName', () => {
  test('names columns positionally rather than from headers', () => {
    expect(createColumnName(0)).toBe('c0');
    expect(createColumnName(511)).toBe('c511');
    expect(isSafeIdentifier(createColumnName(42))).toBe(true);
  });

  test('duplicate headers land at distinct ordinals and so stay distinct', () => {
    expect(createColumnName(1)).not.toBe(createColumnName(2));
  });
});

describe('quoteIdentifier', () => {
  test('quotes a conforming identifier', () => {
    expect(quoteIdentifier('dataset_abc123')).toBe('"dataset_abc123"');
    expect(quoteIdentifier('c0')).toBe('"c0"');
  });

  const injections: readonly [string, string][] = [
    ['embedded quote and statement terminator', 'a"; DROP TABLE x; --'],
    ['statement terminator', 'users; DROP TABLE users'],
    ['comment sequence', 'a--b'],
    ['leading digit', '1relation'],
    ['uppercase', 'Dataset'],
    ['whitespace', 'my relation'],
    ['empty', ''],
    ['unicode homoglyph', 'dataset_аbc'],
    ['zero-width space', 'dataset\u200babc'],
    ['newline', 'dataset\nDROP TABLE x'],
    ['null byte', 'dataset\u0000'],
    ['backtick', '`dataset`'],
    ['dot-qualified name', 'main.dataset'],
    ['overlong', `a${'b'.repeat(63)}`],
  ];

  test.each(injections)('throws on %s', (_label, hostile) => {
    expect(() => quoteIdentifier(hostile)).toThrow();
  });

  test('the thrown message does not echo the rejected identifier', () => {
    // Error text must not include imported identifiers.
    const secret = 'alice_at_example_com';

    try {
      quoteIdentifier(`${secret}; DROP TABLE x`);
      throw new Error('expected quoteIdentifier to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  test('accepts the longest permitted identifier and rejects one character more', () => {
    const longest = `a${'b'.repeat(62)}`;

    expect(longest).toHaveLength(63);
    expect(quoteIdentifier(longest)).toBe(`"${longest}"`);
    expect(() => quoteIdentifier(`${longest}c`)).toThrow();
  });
});
