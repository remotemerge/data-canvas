import { MAX_BIN_COUNT } from '@/domain/analysis/bin-strategy.ts';
import type { BinStrategy, ColumnRange, TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface CompiledBin {
  sql: string;
  parameters: unknown[];
}

// Allowlisted DuckDB `date_trunc` units.
const TRUNC_UNIT: Readonly<Record<TemporalUnit, string>> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

const missingRange = (kind: string): DomainError =>
  domainError('UNSUPPORTED_OPERATION', `Bin strategy '${kind}' requires the column's range.`, { kind });

// Compiles a bin strategy over a resolved column reference.
export const compileBinStrategy = (
  strategy: BinStrategy,
  reference: string,
  range?: ColumnRange,
): Result<CompiledBin, DomainError> => {
  switch (strategy.kind) {
    case 'equalWidth': {
      if (range === undefined) {
        return err(missingRange(strategy.kind));
      }

      const width = (range.max - range.min) / strategy.binCount;

      // A constant column has no range to divide; place every row in one bucket.
      if (!(width > 0)) {
        return ok({ sql: '?', parameters: [range.min] });
      }

      return ok({
        sql: `(FLOOR((${reference} - ?) / ?) * ? + ?)`,
        parameters: [range.min, width, width, range.min],
      });
    }

    case 'equalWidthOf': {
      if (range === undefined) {
        return err(missingRange(strategy.kind));
      }

      const buckets = Math.ceil((range.max - range.min) / strategy.width);

      // Only the compiler knows the column range, so it enforces the resulting bucket count here.
      if (buckets > MAX_BIN_COUNT) {
        return err(
          domainError(
            'RESULT_LIMIT_EXCEEDED',
            `That bin width produces ${buckets} buckets over this column; the limit is ${MAX_BIN_COUNT}.`,
            { buckets, maxBuckets: MAX_BIN_COUNT },
          ),
        );
      }

      return ok({
        sql: `(FLOOR((${reference} - ?) / ?) * ? + ?)`,
        parameters: [range.min, strategy.width, strategy.width, range.min],
      });
    }

    case 'quantile':
      // Quantile edges are data-dependent, so `ntile` returns the bucket ordinal.
      return ok({ sql: `NTILE(?) OVER (ORDER BY ${reference})`, parameters: [strategy.quantiles] });

    case 'explicit': {
      // The validator orders breaks, so the searched CASE arms are non-overlapping.
      const arms = strategy.breaks.map(() => `WHEN ${reference} < ? THEN ?`).join(' ');
      const parameters = strategy.breaks.flatMap((value, index) => [
        value,
        index === 0 ? Number.NEGATIVE_INFINITY : (strategy.breaks[index - 1] as number),
      ]);

      return ok({
        sql: `CASE ${arms} ELSE ? END`,
        parameters: [...parameters, strategy.breaks[strategy.breaks.length - 1] as number],
      });
    }

    case 'temporal':
      return ok({ sql: `date_trunc(?, ${reference})`, parameters: [TRUNC_UNIT[strategy.unit]] });
  }
};
