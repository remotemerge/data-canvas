import type { MetricFormat } from '@/domain/metric/metric.ts';

export const formatNumber = (value: number, format?: MetricFormat): string =>
  new Intl.NumberFormat(undefined, {
    style: format?.style === 'currency' ? 'currency' : format?.style === 'percent' ? 'percent' : 'decimal',
    ...(format?.currency === undefined ? {} : { currency: format.currency }),
    ...(format?.maximumFractionDigits === undefined
      ? { maximumFractionDigits: 2 }
      : { maximumFractionDigits: format.maximumFractionDigits }),
    // An explicit `+` marks a comparison as a change rather than a level. A running total shows no
    // sign, so it stays opt-in through the format.
    ...(format?.showSign === true ? { signDisplay: 'exceptZero' as const } : {}),
  }).format(value);

/**
 * Whether a delta should read as an improvement, a regression, or neither.
 *
 * Direction comes from the metric because the app cannot infer it. Revenue up is good and churn up
 * is not, and both are a `sum` over a number.
 */
export type DeltaTone = 'positive' | 'negative' | 'neutral';

export const deltaTone = (value: number, format?: MetricFormat): DeltaTone => {
  const direction = format?.direction ?? 'neutral';

  if (direction === 'neutral' || value === 0 || !Number.isFinite(value)) return 'neutral';

  const improving = direction === 'increaseIsGood' ? value > 0 : value < 0;

  return improving ? 'positive' : 'negative';
};

export const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (value instanceof Date) return new Intl.DateTimeFormat().format(value);
  return String(value);
};

export const escapeText = (value: unknown): string =>
  formatValue(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
