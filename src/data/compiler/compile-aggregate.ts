import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import { isNumericType, isTemporalType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Aggregates that require numeric input.
const NUMERIC_ONLY = new Set<AggregateFunction>(['sum', 'avg', 'median', 'stddev']);

// Compiles an aggregate over a resolved column reference.
export const compileAggregate = (
  aggregate: AggregateFunction,
  column?: Column,
  reference?: string,
): Result<string, DomainError> => {
  if (aggregate === 'count') {
    return ok('COUNT(*)');
  }
  if (column === undefined) {
    return err(domainError('COLUMN_NOT_FOUND', 'This aggregate requires a column.'));
  }

  // Min and max also accept date and timestamp columns.
  const temporalExtrema = (aggregate === 'min' || aggregate === 'max') && isTemporalType(column.logicalType);
  if (NUMERIC_ONLY.has(aggregate) && !isNumericType(column.logicalType) && !temporalExtrema) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `Aggregate '${aggregate}' requires a numeric column.`, {
        columnId: column.id,
        logicalType: column.logicalType,
      }),
    );
  }

  const identifier = reference ?? quoteIdentifier(column.physicalName);
  if (aggregate === 'count_distinct') {
    return ok(`COUNT(DISTINCT ${identifier})`);
  }
  // Use the explicit sample-estimator name so the generated SQL states the intended definition.
  if (aggregate === 'stddev') {
    return ok(`stddev_samp(${identifier})`);
  }
  return ok(`${aggregate.toUpperCase()}(${identifier})`);
};
