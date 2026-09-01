import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Resolves a physical or derived column ID to its logical type.
export type ColumnTypeResolver = (columnId: EntityId) => LogicalType | undefined;

export const createColumnTypeResolver = (
  columns: readonly Column[],
  derived: readonly DerivedColumn[] = [],
): ColumnTypeResolver => {
  const types = new Map<EntityId, LogicalType>();

  for (const column of columns) {
    types.set(column.id, column.logicalType);
  }
  for (const column of derived) {
    types.set(column.id, column.logicalType);
  }

  return (columnId) => types.get(columnId);
};

const unknownColumn = (columnId: EntityId): DomainError =>
  domainError('COLUMN_NOT_FOUND', `The expression references column '${columnId}', which does not exist.`, {
    columnId,
  });

const literalType = (value: number | string | boolean | null): LogicalType => {
  if (value === null) {
    return 'unknown';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }

  return 'string';
};

// Returns the result type for a numeric arithmetic operation.
const arithmeticType = (operator: string, left: LogicalType, right: LogicalType): Result<LogicalType, DomainError> => {
  for (const [side, type] of [
    ['left', left],
    ['right', right],
  ] as const) {
    if (type !== 'unknown' && !isNumericType(type)) {
      return err(
        domainError(
          'INCOMPATIBLE_COLUMN',
          `Arithmetic '${operator}' requires numeric operands; the ${side} operand is ${type}.`,
          { operator, side, logicalType: type },
        ),
      );
    }
  }

  return ok('number');
};

// Returns whether two logical types can be compared in a `CASE` expression.
const comparable = (left: LogicalType, right: LogicalType): boolean => {
  if (left === 'unknown' || right === 'unknown') {
    return true;
  }
  if (isNumericType(left) && isNumericType(right)) {
    return true;
  }
  if (isTextType(left) && isTextType(right)) {
    return true;
  }
  if (isTemporalType(left) && isTemporalType(right)) {
    return true;
  }

  return left === 'boolean' && right === 'boolean';
};

const castType = (target: 'number' | 'string' | 'date'): LogicalType => target;

// Infers the logical type produced by a validated derived-expression tree.
export const inferExpressionType = (
  expression: DerivedExpression,
  resolve: ColumnTypeResolver,
): Result<LogicalType, DomainError> => {
  switch (expression.kind) {
    case 'column': {
      const type = resolve(expression.columnId);

      return type === undefined ? err(unknownColumn(expression.columnId)) : ok(type);
    }

    case 'literal':
      return ok(literalType(expression.value));

    case 'arithmetic': {
      const left = inferExpressionType(expression.left, resolve);

      if (!left.ok) {
        return left;
      }

      const right = inferExpressionType(expression.right, resolve);

      if (!right.ok) {
        return right;
      }

      return arithmeticType(expression.op, left.value, right.value);
    }

    case 'case': {
      if (expression.when.length === 0) {
        return err(domainError('UNSUPPORTED_OPERATION', 'A case expression needs at least one when arm.'));
      }

      const branches: LogicalType[] = [];

      for (const arm of expression.when) {
        const left = inferExpressionType(arm.left, resolve);

        if (!left.ok) {
          return left;
        }

        const right = inferExpressionType(arm.right, resolve);

        if (!right.ok) {
          return right;
        }

        if (!comparable(left.value, right.value)) {
          return err(
            domainError(
              'INCOMPATIBLE_COLUMN',
              `A case arm compares ${left.value} with ${right.value}, which are not comparable.`,
              { left: left.value, right: right.value },
            ),
          );
        }

        const armResult = inferExpressionType(arm.result, resolve);

        if (!armResult.ok) {
          return armResult;
        }

        branches.push(armResult.value);
      }

      const otherwise = inferExpressionType(expression.otherwise, resolve);

      if (!otherwise.ok) {
        return otherwise;
      }

      branches.push(otherwise.value);

      // All non-unknown branches must agree on the result type.
      const known = [...new Set(branches.filter((type) => type !== 'unknown'))];

      if (known.length > 1) {
        return err(
          domainError('INCOMPATIBLE_COLUMN', `Case branches return conflicting types: ${known.join(', ')}.`, {
            types: known,
          }),
        );
      }

      return ok(known[0] ?? 'unknown');
    }

    case 'datePart': {
      const type = resolve(expression.columnId);

      if (type === undefined) {
        return err(unknownColumn(expression.columnId));
      }

      if (!isTemporalType(type)) {
        return err(
          domainError(
            'INCOMPATIBLE_COLUMN',
            `'${expression.part}' requires a date or timestamp column; that column is ${type}.`,
            { part: expression.part, columnId: expression.columnId, logicalType: type },
          ),
        );
      }

      return ok('number');
    }

    case 'bin': {
      const type = resolve(expression.columnId);

      if (type === undefined) {
        return err(unknownColumn(expression.columnId));
      }

      const temporal = expression.strategy.kind === 'temporal';

      if (temporal && !isTemporalType(type)) {
        return err(
          domainError('INCOMPATIBLE_COLUMN', `Temporal binning requires a date or timestamp column; got ${type}.`, {
            columnId: expression.columnId,
            logicalType: type,
          }),
        );
      }

      if (!temporal && !isNumericType(type)) {
        return err(
          domainError('INCOMPATIBLE_COLUMN', `Numeric binning requires a numeric column; got ${type}.`, {
            columnId: expression.columnId,
            logicalType: type,
          }),
        );
      }

      // Temporal bins return timestamps; numeric bins return bucket numbers.
      return ok(temporal ? type : 'number');
    }

    case 'cast': {
      // Resolve the operand before applying the target type so unknown references still fail.
      const operand = inferExpressionType(expression.expr, resolve);

      return operand.ok ? ok(castType(expression.to)) : operand;
    }
  }
};
