import type { ColumnReferenceResolver } from '@/data/compiler/compile-filter-expression.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface CompiledModifier {
  sql: string;
  parameters: unknown[];
}

/**
 * Wraps a compiled aggregate in the window function its modifier calls for.
 *
 * `aggregate` is already-compiled SQL such as `SUM("c2")`, so this only ever concatenates trusted
 * fragments. The window's `ORDER BY` reference comes from the same identifier resolver the rest of
 * the compiler uses and is quoted before it arrives.
 *
 * `timeComparison` is absent here on purpose. It needs a gap-filled date spine, so it changes the
 * query's FROM clause rather than only its select list, and it is compiled by `compile-time-spine`.
 */
export const compileMetricModifier = (
  modifier: MetricModifier | undefined,
  aggregate: string,
  resolve: ColumnReferenceResolver,
): Result<CompiledModifier, DomainError> => {
  if (modifier === undefined || modifier.kind === 'none') return ok({ sql: aggregate, parameters: [] });

  switch (modifier.kind) {
    case 'percentOfTotal':
      // The denominator is the same aggregate over an empty window, which is the grand total across
      // every group the query returns. NULLIF keeps an all-zero result from failing the statement.
      return ok({
        sql: `(${aggregate} / NULLIF(SUM(${aggregate}) OVER (), 0))`,
        parameters: [],
      });

    case 'runningTotal': {
      const ordering = resolve(modifier.orderBy);

      if (ordering === undefined) {
        return err(
          domainError('COLUMN_NOT_FOUND', 'The running total orders by a column that does not exist.', {
            columnId: modifier.orderBy,
          }),
        );
      }

      return ok({
        sql: `SUM(${aggregate}) OVER (ORDER BY ${ordering.sql} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`,
        parameters: [],
      });
    }

    case 'timeComparison':
      return err(
        domainError('UNSUPPORTED_OPERATION', 'A time comparison is compiled with its date spine, not in isolation.', {
          kind: modifier.kind,
        }),
      );
  }
};
