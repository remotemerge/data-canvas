import {
  MAX_BIN_COUNT,
  MAX_EXPLICIT_BREAKS,
  MAX_QUANTILE_COUNT,
  MIN_BIN_COUNT,
  MIN_QUANTILE_COUNT,
  TEMPORAL_UNITS,
} from '@/domain/analysis/bin-strategy.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

const outOfRange = (field: string, value: number, min: number, max: number): DomainError =>
  domainError('RESULT_LIMIT_EXCEEDED', `${field} must be between ${min} and ${max}; got ${value}.`, {
    field,
    value,
    min,
    max,
  });

const notFinite = (field: string): DomainError =>
  domainError('UNSUPPORTED_OPERATION', `${field} must be a finite number.`, { field });

/**
 * Checks a bin strategy's bounds before it can reach the compiler.
 *
 * Every limit here caps the number of result rows a histogram can produce, so this is the query's
 * size guard as much as a correctness check. The compiler assumes a validated strategy and does not
 * re-check these.
 */
export const validateBinStrategy = (strategy: BinStrategy): Result<void, DomainError> => {
  switch (strategy.kind) {
    case 'equalWidth': {
      if (!Number.isInteger(strategy.binCount)) {
        return err(domainError('UNSUPPORTED_OPERATION', 'binCount must be a whole number.', { field: 'binCount' }));
      }

      return strategy.binCount < MIN_BIN_COUNT || strategy.binCount > MAX_BIN_COUNT
        ? err(outOfRange('binCount', strategy.binCount, MIN_BIN_COUNT, MAX_BIN_COUNT))
        : ok(undefined);
    }

    case 'equalWidthOf': {
      if (!Number.isFinite(strategy.width)) return err(notFinite('width'));

      // A non-positive width would make the bucket count infinite or negative. The upper bound on
      // resulting buckets is enforced by the compiler, which knows the column's actual range.
      return strategy.width <= 0
        ? err(domainError('UNSUPPORTED_OPERATION', 'Bin width must be greater than zero.', { field: 'width' }))
        : ok(undefined);
    }

    case 'quantile': {
      if (!Number.isInteger(strategy.quantiles)) {
        return err(domainError('UNSUPPORTED_OPERATION', 'quantiles must be a whole number.', { field: 'quantiles' }));
      }

      return strategy.quantiles < MIN_QUANTILE_COUNT || strategy.quantiles > MAX_QUANTILE_COUNT
        ? err(outOfRange('quantiles', strategy.quantiles, MIN_QUANTILE_COUNT, MAX_QUANTILE_COUNT))
        : ok(undefined);
    }

    case 'explicit': {
      const { breaks } = strategy;

      if (breaks.length < 1 || breaks.length > MAX_EXPLICIT_BREAKS) {
        return err(outOfRange('breaks', breaks.length, 1, MAX_EXPLICIT_BREAKS));
      }

      if (breaks.some((value) => !Number.isFinite(value))) return err(notFinite('breaks'));

      // Ascending order is what makes the compiled `CASE` arms exhaustive and non-overlapping. An
      // unsorted list would compile without error and silently misplace rows.
      for (let index = 1; index < breaks.length; index += 1) {
        if ((breaks[index] as number) <= (breaks[index - 1] as number)) {
          return err(
            domainError('UNSUPPORTED_OPERATION', 'Bin breaks must be strictly ascending.', {
              field: 'breaks',
              index,
            }),
          );
        }
      }

      return ok(undefined);
    }

    case 'temporal':
      return TEMPORAL_UNITS.includes(strategy.unit)
        ? ok(undefined)
        : err(
            domainError('UNSUPPORTED_OPERATION', `Unknown temporal bin unit '${strategy.unit as string}'.`, {
              unit: strategy.unit,
            }),
          );
  }
};
