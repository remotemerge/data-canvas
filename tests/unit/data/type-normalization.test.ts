import { describe, expect, test } from 'bun:test';
import { CATEGORY_DISTINCT_THRESHOLD, normalizeLogicalType, refineTextType } from '@/data/duckdb/type-normalization.ts';
import { LOGICAL_TYPES } from '@/domain/logical-type.ts';

describe('normalizeLogicalType', () => {
  const cases: readonly [string, string][] = [
    ['BIGINT', 'number'],
    ['INTEGER', 'number'],
    ['SMALLINT', 'number'],
    ['TINYINT', 'number'],
    ['HUGEINT', 'number'],
    ['UBIGINT', 'number'],
    ['DOUBLE', 'number'],
    ['FLOAT', 'number'],
    ['DECIMAL(18,3)', 'number'],
    ['VARCHAR', 'string'],
    ['VARCHAR(255)', 'string'],
    ['UUID', 'string'],
    ['BOOLEAN', 'boolean'],
    ['DATE', 'date'],
    ['TIMESTAMP', 'timestamp'],
    ['TIMESTAMP WITH TIME ZONE', 'timestamp'],
    ['TIMESTAMP_NS', 'timestamp'],
  ];

  test.each(cases)('maps %s to %s', (databaseType, expected) => {
    expect(normalizeLogicalType(databaseType)).toBe(expected as never);
  });

  test('is case-insensitive', () => {
    expect(normalizeLogicalType('bigint')).toBe('number');
    expect(normalizeLogicalType('Varchar(10)')).toBe('string');
  });

  const unrecognized = ['STRUCT(a VARCHAR)', 'MAP(VARCHAR, INTEGER)', 'VARCHAR[]', 'BLOB', 'INTERVAL', 'UNION', ''];

  test.each(unrecognized)('maps unrecognized type %p to unknown', (databaseType) => {
    expect(normalizeLogicalType(databaseType)).toBe('unknown');
  });

  test('a nested type is not classified by the scalar it contains', () => {
    // Substring matching would call this a string; a struct is genuinely outside the domain.
    expect(normalizeLogicalType('STRUCT(name VARCHAR, age INTEGER)')).toBe('unknown');
  });

  test('never returns category, which no physical type can express', () => {
    const produced = new Set([...cases.map(([type]) => normalizeLogicalType(type)), normalizeLogicalType('BLOB')]);

    expect(produced.has('category')).toBe(false);
  });

  test('every result is a member of the domain type union', () => {
    for (const [databaseType] of cases) {
      expect(LOGICAL_TYPES).toContain(normalizeLogicalType(databaseType));
    }
  });
});

describe('refineTextType', () => {
  test('refines a low-cardinality string to category', () => {
    expect(refineTextType('string', 12)).toBe('category');
    expect(refineTextType('string', CATEGORY_DISTINCT_THRESHOLD)).toBe('category');
  });

  test('leaves a high-cardinality string alone', () => {
    expect(refineTextType('string', CATEGORY_DISTINCT_THRESHOLD + 1)).toBe('string');
  });

  test('never refines a non-string column', () => {
    // A low-cardinality numeric column must keep its arithmetic operators.
    expect(refineTextType('number', 3)).toBe('number');
    expect(refineTextType('boolean', 2)).toBe('boolean');
    expect(refineTextType('date', 1)).toBe('date');
    expect(refineTextType('unknown', 1)).toBe('unknown');
  });
});
