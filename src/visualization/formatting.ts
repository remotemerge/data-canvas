import type { MetricFormat } from '@/domain/metric/metric.ts';

export const formatNumber = (value: number, format?: MetricFormat): string =>
  new Intl.NumberFormat(undefined, {
    style: format?.style === 'currency' ? 'currency' : format?.style === 'percent' ? 'percent' : 'decimal',
    ...(format?.currency === undefined ? {} : { currency: format.currency }),
    ...(format?.maximumFractionDigits === undefined
      ? { maximumFractionDigits: 2 }
      : { maximumFractionDigits: format.maximumFractionDigits }),
  }).format(value);

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
