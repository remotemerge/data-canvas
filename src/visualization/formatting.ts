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

/*
 * Returns a value's own `toString` when it overrides Object's, so stringifying it yields more than
 * `[object Object]`. A null-prototype object has no `toString` at all and is excluded here, because
 * calling it would throw on data the user imported.
 */
const selfDescription = (value: object): (() => string) | undefined => {
  const { toString } = value as { toString?: unknown };

  return typeof toString === 'function' && toString !== Object.prototype.toString
    ? (toString as () => string)
    : undefined;
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
   * A value carrying a `toString` other than Object's describes itself. Values that inherit Object's
   * would render as `[object Object]`, so those are shown as JSON; the catch covers cyclic values.
   */
  const describe = selfDescription(value);

  if (describe !== undefined) {
    // Called with the original receiver, since the method was read off the value.
    return String(describe.call(value));
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
