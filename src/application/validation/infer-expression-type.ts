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

/**
 * Resolves a column ID to its logical type.
 *
 * Takes both physical columns and previously defined derived columns, since a derived column may
 * build on another one. Returning `undefined` means the reference is unknown, which the caller
 * reports as `COLUMN_NOT_FOUND` rather than guessing a type.
 */
export type ColumnTypeResolver = (columnId: EntityId) => LogicalType | undefined;

export const createColumnTypeResolver = (
  columns: readonly Column[],
  derived: readonly DerivedColumn[] = [],
): ColumnTypeResolver => {
  const types = new Map<EntityId, LogicalType>();

  for (const column of columns) types.set(column.id, column.logicalType);
  for (const column of derived) types.set(column.id, column.logicalType);

  return (columnId) => types.get(columnId);
};

const unknownColumn = (columnId: EntityId): DomainError =>
  domainError('COLUMN_NOT_FOUND', `The expression references column '${columnId}', which does not exist.`, {
    columnId,
  });

const literalType = (value: number | string | boolean | null): LogicalType => {
  if (value === null) return 'unknown';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';

  return 'string';
};

/**
 * The type an arithmetic operator produces.
 *
 * Only numbers are accepted. Adding two strings is a concatenation in some engines and an error in
 * others, and letting it through here would make the derived column's meaning depend on DuckDB's
 * coercion rules rather than on the expression the user built. `unknown` is tolerated because a
 * `NULL` literal has no type until it meets an operand.
 */
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

/**
 * Whether two types can be compared in a `CASE` arm.
 *
 * Comparison is looser than arithmetic on purpose: ordering dates and matching strings are both
 * meaningful. What it rejects is comparing across families, where the result would depend on an
 * implicit cast the user never asked for.
 */
const comparable = (left: LogicalType, right: LogicalType): boolean => {
  if (left === 'unknown' || right === 'unknown') return true;
  if (isNumericType(left) && isNumericType(right)) return true;
  if (isTextType(left) && isTextType(right)) return true;
  if (isTemporalType(left) && isTemporalType(right)) return true;

  return left === 'boolean' && right === 'boolean';
};

const castType = (target: 'number' | 'string' | 'date'): LogicalType => target;

/**
 * Walks an expression tree and predicts its result type.
 *
 * The prediction is checked against DuckDB's own result type the first time the column is queried,
 * and the stored type corrected if they disagree. This exists to reject nonsense before it reaches
 * SQL, not to be the final authority on the answer.
 *
 * Depth and node count are enforced by `validateDerivedExpression`, so this walker assumes a tree
 * that has already passed those bounds.
 */
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

      if (!left.ok) return left;

      const right = inferExpressionType(expression.right, resolve);

      if (!right.ok) return right;

      return arithmeticType(expression.op, left.value, right.value);
    }

    case 'case': {
      if (expression.when.length === 0) {
        return err(domainError('UNSUPPORTED_OPERATION', 'A case expression needs at least one when arm.'));
      }

      const branches: LogicalType[] = [];

      for (const arm of expression.when) {
        const left = inferExpressionType(arm.left, resolve);

        if (!left.ok) return left;

        const right = inferExpressionType(arm.right, resolve);

        if (!right.ok) return right;

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

        if (!armResult.ok) return armResult;

        branches.push(armResult.value);
      }

      const otherwise = inferExpressionType(expression.otherwise, resolve);

      if (!otherwise.ok) return otherwise;

      branches.push(otherwise.value);

      // Branches must agree, otherwise the column's type depends on which row is read. `unknown`
      // branches are ignored, so a `NULL` fallback does not force the whole expression to unknown.
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

      if (type === undefined) return err(unknownColumn(expression.columnId));

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

      if (type === undefined) return err(unknownColumn(expression.columnId));

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

      // A temporal bin returns the truncated instant; a numeric bin returns the bucket's ordinal.
      return ok(temporal ? type : 'number');
    }

    case 'cast': {
      // The operand's own type is discarded, but it is still resolved: a cast over an unknown
      // column must fail on the bad reference rather than silently adopting the target type.
      const operand = inferExpressionType(expression.expr, resolve);

      return operand.ok ? ok(castType(expression.to)) : operand;
    }
  }
};
