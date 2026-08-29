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

/**
 * DuckDB's `date_trunc` unit names.
 *
 * A fixed lookup rather than an interpolated domain value, so the emitted string can only ever be
 * one of these five literals no matter what a caller passes.
 */
const TRUNC_UNIT: Readonly<Record<TemporalUnit, string>> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

const missingRange = (kind: string): DomainError =>
  domainError('UNSUPPORTED_OPERATION', `Bin strategy '${kind}' requires the column's range.`, { kind });

/**
 * Compiles a bin strategy into a grouping expression over an already-resolved column reference.
 *
 * `reference` is emitted by the caller's identifier resolver and is quoted before it arrives, so
 * this function never touches a physical name. Every numeric boundary becomes a bound parameter
 * rather than SQL text, which keeps the strategy's numbers on the same footing as filter values.
 *
 * Returns the bucket's lower bound, not its ordinal, so a chart axis reads in the column's own units
 * without the renderer having to reverse the bucketing.
 */
export const compileBinStrategy = (
  strategy: BinStrategy,
  reference: string,
  range?: ColumnRange,
): Result<CompiledBin, DomainError> => {
  switch (strategy.kind) {
    case 'equalWidth': {
      if (range === undefined) return err(missingRange(strategy.kind));

      const width = (range.max - range.min) / strategy.binCount;

      // A constant column has no width to divide by. One bucket holding every row is the honest
      // answer; emitting a division would yield NULL for the whole chart.
      if (!(width > 0)) return ok({ sql: '?', parameters: [range.min] });

      return ok({
        sql: `(FLOOR((${reference} - ?) / ?) * ? + ?)`,
        parameters: [range.min, width, width, range.min],
      });
    }

    case 'equalWidthOf': {
      if (range === undefined) return err(missingRange(strategy.kind));

      const buckets = Math.ceil((range.max - range.min) / strategy.width);

      // Guards the one bin bound the validator cannot check: it sees the width but not the range,
      // so only here is the resulting bucket count knowable.
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
      // `ntile` returns the bucket's ordinal rather than a value boundary, because quantile edges
      // are data-dependent and cannot be computed without a second pass over the column.
      return ok({ sql: `NTILE(?) OVER (ORDER BY ${reference})`, parameters: [strategy.quantiles] });

    case 'explicit': {
      // Emitted as a searched CASE over ascending breaks. The validator guarantees the order, which
      // is what makes the arms non-overlapping and the first match correct.
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
