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
  // Result column keys in SELECT order.
  resultKeys: string[];
}

// Allowlisted DuckDB intervals used by `generate_series`.
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

// Computes the comparison value for the current and prior period.
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
  // Compiled aggregate, such as `SUM("c2")`.
  aggregate: string;
  // Placeholders embedded in `aggregate`, such as a derived expression's literals.
  aggregateParameters?: readonly unknown[];
  // Base FROM/JOIN fragment.
  from: string;
  // WHERE fragment without the keyword.
  where: string;
  whereParameters: readonly unknown[];
  resolve: ColumnReferenceResolver;
  limit: number;
}

// Compiles a time comparison over a gap-filled temporal axis.
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

  // Aggregate by period, build the complete period spine, then join them so gaps appear as zero.
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

  /*
   * Bind parameters in statement order: the trunc unit, any placeholders inside the aggregate
   * expression, the filters, then the lag offset. A derived-column measure compiles to an
   * expression carrying its own literals, so those bind before the WHERE clause that follows it.
   */
  return ok({
    sql,
    parameters: [truncUnit, ...(request.aggregateParameters ?? []), ...request.whereParameters, modifier.offset],
    resultKeys: ['d0', 'm0', 'm1'],
  });
};
