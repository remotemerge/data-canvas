import type { MetricFormat } from '@/domain/metric/metric.ts';

const numberStyle = (style: MetricFormat['style'] | undefined): 'currency' | 'percent' | 'decimal' => {
  if (style === 'currency') {
    return 'currency';
  }

  return style === 'percent' ? 'percent' : 'decimal';
};

export const formatNumber = (value: number, format?: MetricFormat): string =>
  new Intl.NumberFormat(undefined, {
    style: numberStyle(format?.style),
    ...(format?.currency === undefined ? {} : { currency: format.currency }),
    ...(format?.maximumFractionDigits === undefined
      ? { maximumFractionDigits: 2 }
      : { maximumFractionDigits: format.maximumFractionDigits }),
    // Show an explicit plus only for delta values; running totals remain unsigned.
    ...(format?.showSign === true ? { signDisplay: 'exceptZero' as const } : {}),
  }).format(value);

// Classifies a delta using the metric's configured direction.
export type DeltaTone = 'positive' | 'negative' | 'neutral';

export const deltaTone = (value: number, format?: MetricFormat): DeltaTone => {
  const direction = format?.direction ?? 'neutral';

  if (direction === 'neutral' || value === 0 || !Number.isFinite(value)) {
    return 'neutral';
  }

  const improving = direction === 'increaseIsGood' ? value > 0 : value < 0;

  return improving ? 'positive' : 'negative';
};

export const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (value instanceof Date) {
    return new Intl.DateTimeFormat().format(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  /*
   * A value carrying its own `toString` describes itself. Plain objects inherit Object's, which
   * renders as `[object Object]`, so those are shown as JSON; the catch covers cyclic values.
   */
  const text = String(value);

  if (text !== '[object Object]') {
    return text;
  }

  try {
    return JSON.stringify(value) ?? '—';
  } catch {
    return '—';
  }
};

export const escapeText = (value: unknown): string =>
  formatValue(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
