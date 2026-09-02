import { describe, expect, test } from 'bun:test';
import { FILTER_OPERATORS, filterValueText, NULLARY_FILTER_OPERATORS } from '@/domain/filter/filter.ts';

describe('filter operators', () => {
  test('the nullary operators are the ones carrying no value', () => {
    expect([...NULLARY_FILTER_OPERATORS]).toEqual(['is_null', 'is_not_null']);
  });

  test('every nullary operator is also a known operator', () => {
    for (const operator of NULLARY_FILTER_OPERATORS) {
      expect(FILTER_OPERATORS).toContain(operator);
    }
  });
});

describe('filterValueText', () => {
  test('an absent value renders as empty text rather than the word null', () => {
    expect(filterValueText(null)).toBe('');
    expect(filterValueText(undefined)).toBe('');
  });

  test('scalars render as their literal text', () => {
    expect(filterValueText('north')).toBe('north');
    expect(filterValueText(42)).toBe('42');
    expect(filterValueText(0)).toBe('0');
    expect(filterValueText(true)).toBe('true');
    expect(filterValueText(9007199254740993n)).toBe('9007199254740993');
  });

  test('an array renders as a comma separated list, as used by in and not_in', () => {
    expect(filterValueText(['north', 'south'])).toBe('north, south');
  });

  test('a between pair of numbers keeps both bounds', () => {
    expect(filterValueText([1, 10])).toBe('1, 10');
  });

  test('nested and empty arrays flatten through the same rendering', () => {
    expect(filterValueText([])).toBe('');
    expect(filterValueText([['a', 'b'], 'c'])).toBe('a, b, c');
  });

  test('an absent entry inside an array renders as empty text', () => {
    expect(filterValueText(['a', null, 'b'])).toBe('a, , b');
  });

  test('a Date renders as an ISO string so the bound stays unambiguous', () => {
    expect(filterValueText(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  // Imported values are typed `unknown`; a non-scalar object must not leak `[object Object]`.
  test('a non-scalar object is described by shape instead of stringified', () => {
    expect(filterValueText({ nested: true })).toBe('a value');
    expect(filterValueText(Object.create(null) as object)).toBe('a value');
  });
});
