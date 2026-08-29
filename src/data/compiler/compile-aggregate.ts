import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import { isNumericType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * Compiles an aggregate over one column.
 *
 * `reference` lets a joined query supply an alias-qualified identifier. Omitted, the column's own
 * physical name is quoted, which is correct for a query over a single relation.
 */
export const compileAggregate = (
  aggregate: AggregateFunction,
  column?: Column,
  reference?: string,
): Result<string, DomainError> => {
  if (aggregate === 'count') return ok('COUNT(*)');
  if (column === undefined) return err(domainError('COLUMN_NOT_FOUND', 'This aggregate requires a column.'));

  if ((aggregate === 'sum' || aggregate === 'avg' || aggregate === 'median') && !isNumericType(column.logicalType)) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `Aggregate '${aggregate}' requires a numeric column.`, {
        columnId: column.id,
        logicalType: column.logicalType,
      }),
    );
  }

  const identifier = reference ?? quoteIdentifier(column.physicalName);
  if (aggregate === 'count_distinct') return ok(`COUNT(DISTINCT ${identifier})`);
  return ok(`${aggregate.toUpperCase()}(${identifier})`);
};
