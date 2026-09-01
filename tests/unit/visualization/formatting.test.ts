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
