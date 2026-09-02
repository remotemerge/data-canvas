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

// Applies a window modifier to an already-compiled aggregate.
export const compileMetricModifier = (
  modifier: MetricModifier | undefined,
  aggregate: string,
  resolve: ColumnReferenceResolver,
): Result<CompiledModifier, DomainError> => {
  if (modifier === undefined || modifier.kind === 'none') {
    return ok({ sql: aggregate, parameters: [] });
  }

  switch (modifier.kind) {
    case 'percentOfTotal':
      // Divide by the grand total; NULLIF handles an all-zero result.
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
