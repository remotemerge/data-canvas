import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import { isNumericType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export const compileAggregate = (aggregate: AggregateFunction, column?: Column): Result<string, DomainError> => {
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

  const identifier = quoteIdentifier(column.physicalName);
  if (aggregate === 'count_distinct') return ok(`COUNT(DISTINCT ${identifier})`);
  return ok(`${aggregate.toUpperCase()}(${identifier})`);
};
