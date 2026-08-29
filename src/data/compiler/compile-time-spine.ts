import type { ColumnReferenceResolver } from '@/data/compiler/compile-filter-expression.ts';
import type { TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import { MAX_TIME_COMPARISON_OFFSET } from '@/domain/metric/metric-modifier.ts';
import type { MetricModifier, TimeComparisonOutput } from '@/domain/metric/metric-modifier.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface CompiledTimeComparison {
  sql: string;
  parameters: unknown[];
  /** Result column keys the query emits, in select order. */
  resultKeys: string[];
}

/**
 * DuckDB interval literals, one per bucket unit.
 *
 * A fixed table so the interval reaching `generate_series` can only be one of these five strings.
 * DuckDB will not accept an interval as a bound parameter in a series bound, so this is the one
 * place a unit becomes SQL text, and a lookup is what keeps that safe.
 */
const SERIES_INTERVAL: Readonly<Record<TemporalUnit, string>> = {
  day: "INTERVAL '1 day'",
  week: "INTERVAL '1 week'",
  month: "INTERVAL '1 month'",
  quarter: "INTERVAL '3 months'",
  year: "INTERVAL '1 year'",
};

const TRUNC_UNIT: Readonly<Record<TemporalUnit, string>> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

/**
 * How the current and prior period combine into the returned value.
 *
 * `percentChange` divides through `NULLIF`, so a prior period of zero yields NULL rather than
 * failing. That matters more than usual here: a gap-filled spine deliberately produces zero-valued
 * periods, so the zero denominator is the expected case rather than a rare one.
 */
const comparisonSql = (output: TimeComparisonOutput, current: string, prior: string): string => {
  switch (output) {
    case 'absolute':
      return prior;
    case 'difference':
      return `(${current} - ${prior})`;
    case 'percentChange':
      return `((${current} - ${prior}) / NULLIF(${prior}, 0))`;
  }
};

export interface TimeSpineRequest {
  modifier: Extract<MetricModifier, { kind: 'timeComparison' }>;
  /** Compiled aggregate, for example `SUM("c2")`. */
  aggregate: string;
  /** The FROM/JOIN fragment the base query would use. */
  from: string;
  /** Compiled WHERE fragment without the keyword, or an empty string. */
  where: string;
  whereParameters: readonly unknown[];
  resolve: ColumnReferenceResolver;
  limit: number;
}

/**
 * Compiles a time comparison over a gap-filled date axis.
 *
 * The gap filling is the whole point. `LAG` steps back one *row*, not one period, so a month with
 * no rows would silently shift the comparison onto the wrong month and the chart would look
 * plausible while being wrong. Generating the series and left-joining the aggregate onto it means
 * every period exists, so `LAG` and the period offset agree.
 *
 * The series runs between the column's own min and max, both read inside the statement, so the spine
 * needs no pre-query and stays consistent with whatever the filters selected.
 */
export const compileTimeSpine = (request: TimeSpineRequest): Result<CompiledTimeComparison, DomainError> => {
  const { modifier, aggregate, from, where, resolve, limit } = request;

  if (!Number.isInteger(modifier.offset) || modifier.offset < 1 || modifier.offset > MAX_TIME_COMPARISON_OFFSET) {
    return err(
      domainError(
        'RESULT_LIMIT_EXCEEDED',
        `A time comparison offset must be between 1 and ${MAX_TIME_COMPARISON_OFFSET}; got ${modifier.offset}.`,
        { offset: modifier.offset, maxOffset: MAX_TIME_COMPARISON_OFFSET },
      ),
    );
  }

  const dateColumn = resolve(modifier.dateColumnId);

  if (dateColumn === undefined) {
    return err(
      domainError('COLUMN_NOT_FOUND', 'The time comparison references a date column that does not exist.', {
        columnId: modifier.dateColumnId,
      }),
    );
  }

  const interval = SERIES_INTERVAL[modifier.unit];
  const truncUnit = TRUNC_UNIT[modifier.unit];

  if (interval === undefined || truncUnit === undefined) {
    return err(
      domainError('UNSUPPORTED_OPERATION', 'That time comparison unit is not supported.', {
        unit: modifier.unit,
      }),
    );
  }

  const whereClause = where === '' ? '' : `WHERE ${where}`;

  // Three stages. `bucketed` aggregates per period, `spine` enumerates every period between the
  // observed bounds, and the outer select joins them so absent periods appear as zero.
  const sql = [
    'WITH bucketed AS (',
    `SELECT date_trunc(?, ${dateColumn.sql}) AS bucket, ${aggregate} AS value`,
    `FROM ${from}`,
    whereClause,
    'GROUP BY 1',
    '), bounds AS (SELECT MIN(bucket) AS lo, MAX(bucket) AS hi FROM bucketed',
    '), spine AS (',
    `SELECT UNNEST(generate_series(bounds.lo, bounds.hi, ${interval})) AS bucket FROM bounds`,
    ')',
    'SELECT spine.bucket AS d0,',
    'COALESCE(bucketed.value, 0) AS m0,',
    `${comparisonSql(
      modifier.as,
      'COALESCE(bucketed.value, 0)',
      `LAG(COALESCE(bucketed.value, 0), ?) OVER (ORDER BY spine.bucket)`,
    )} AS m1`,
    'FROM spine LEFT JOIN bucketed ON bucketed.bucket = spine.bucket',
    'ORDER BY spine.bucket',
    `LIMIT ${limit}`,
  ]
    .filter((fragment) => fragment !== '')
    .join(' ');

  // Parameter order follows the statement: the trunc unit opens `bucketed`, the filter values
  // follow inside it, and the lag offset appears last in the outer select.
  return ok({
    sql,
    parameters: [truncUnit, ...request.whereParameters, modifier.offset],
    resultKeys: ['d0', 'm0', 'm1'],
  });
};
