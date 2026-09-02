import { describe, expect, test } from 'bun:test';
import { deltaTone, escapeText, formatNumber, formatValue } from '@/visualization/formatting.ts';
import type { MetricFormat } from '@/domain/metric/metric.ts';

describe('formatNumber', () => {
  test('rounds a decimal to the requested fraction digits', () => {
    expect(formatNumber(12.345, { style: 'decimal', maximumFractionDigits: 1 })).toBe('12.3');
  });

  test('scales a percent style by a hundred', () => {
    expect(formatNumber(0.125, { style: 'percent', maximumFractionDigits: 1 })).toBe('12.5%');
  });

  test('a signed currency delta keeps its currency symbol', () => {
    const formatted = formatNumber(12, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      showSign: true,
    });

    expect(formatted).toContain('$12');
  });
});

describe('formatValue', () => {
  test('renders an absent value as an em dash rather than an empty cell', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
  });

  test('a number goes through the shared number format', () => {
    expect(formatValue(3.5)).toBe('3.5');
  });

  test('a Date renders as a locale date instead of an ISO string', () => {
    expect(formatValue(new Date('2026-01-02T00:00:00.000Z'))).not.toBe('');
  });

  test('a boolean renders as its literal text', () => {
    expect(formatValue(false)).toBe('false');
  });

  test('a string and a bigint render as their literal text', () => {
    expect(formatValue('north')).toBe('north');
    expect(formatValue(9007199254740993n)).toBe('9007199254740993');
  });

  // A value with its own `toString` describes itself better than JSON would.
  test('a value carrying its own toString renders through it', () => {
    expect(formatValue({ toString: () => 'custom' })).toBe('custom');
  });

  /*
   * Values inheriting Object's `toString` would render as `[object Object]`, so they are shown as
   * JSON instead.
   */
  test('a plain object renders as JSON rather than [object Object]', () => {
    expect(formatValue({ region: 'north' })).toBe('{"region":"north"}');
  });

  // An array carries Array's own `toString`, so it joins rather than going through JSON.
  test('an array renders as its joined text', () => {
    expect(formatValue([1, 2])).toBe('1,2');
  });

  // A null-prototype object has no `toString` at all; calling one would throw on imported data.
  test('a null-prototype object falls through to JSON without throwing', () => {
    const value = Object.assign(Object.create(null) as object, { region: 'north' });

    expect(formatValue(value)).toBe('{"region":"north"}');
  });

  test('a cyclic value renders as an em dash instead of throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    expect(formatValue(cyclic)).toBe('—');
  });

  // Functions and symbols carry their own `toString`, so they describe themselves.
  test('a function and a symbol render through their own toString', () => {
    expect(formatValue(Symbol('tag'))).toBe('Symbol(tag)');
    expect(formatValue(() => 'noop')).toContain('noop');
  });
});

describe('deltaTone', () => {
  const increaseIsGood: MetricFormat = { style: 'plain', direction: 'increaseIsGood' };
  const increaseIsBad: MetricFormat = { style: 'plain', direction: 'increaseIsBad' };

  test('a rise is positive when increases are good and negative when they are bad', () => {
    expect(deltaTone(1, increaseIsGood)).toBe('positive');
    expect(deltaTone(1, increaseIsBad)).toBe('negative');
  });

  test('a fall inverts alongside the configured direction', () => {
    expect(deltaTone(-1, increaseIsGood)).toBe('negative');
    expect(deltaTone(-1, increaseIsBad)).toBe('positive');
  });

  test('an unchanged value carries no tone, even without a format', () => {
    expect(deltaTone(0)).toBe('neutral');
  });

  test('a non-finite delta is neutral rather than mislabelled', () => {
    expect(deltaTone(Number.NaN, increaseIsGood)).toBe('neutral');
  });
});

describe('escapeText', () => {
  // Dataset-derived text reaches tooltips as markup, so every HTML-significant character is escaped.
  test('escapes angle brackets, quotes, and ampersands in dataset-derived text', () => {
    expect(escapeText(`<tag a="b">'&`)).toBe('&lt;tag a=&quot;b&quot;&gt;&#39;&amp;');
  });
});
